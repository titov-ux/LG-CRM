"""AI-скоринг соответствия кандидат ↔ вакансия.

Гибрид «детерминированная арифметика + качественная оценка LLM»:

  • Веса критериев фиксированы в коде (`WEIGHTS`) — итоговое число воспроизводимо
    и объяснимо, мы НЕ просим модель решать вклад критериев.
  • `cheap_score()` считает всё, что считается без модели (пересечение стека,
    дистанция грейда, опыт, формат, ставка). Это быстрый путь и фоллбэк, когда
    AI недоступен (нет ключа / 503).
  • `score_match()` поверх cheap-базы накладывает оценку LLM по каждому критерию
    (`score` + `note`) и текстовый вердикт (`summary`, `strengths`, `gaps`),
    после чего итог пересчитывается на бэкенде по фиксированным весам.

Ошибки LLM (`AiUnavailableError` / `AiBadRequestError` / `AiTruncatedJsonError`)
пробрасываются наверх и обрабатываются в эндпоинте `api/v1/endpoints/matching.py`.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from app.core.config import get_settings
from app.integrations.yandex_gpt import (
    AiBadRequestError,
    AiTruncatedJsonError,
    AiUnavailableError,
    YandexGptClient,
)
from app.modules.candidates.briefs import candidate_brief, vacancy_brief

logger = logging.getLogger(__name__)

# Фиксированные веса критериев (сумма = 1.0). Если критерий неприменим (нет
# данных), он отбрасывается, а веса оставшихся ренормализуются.
#
# `relevance` (релевантность реального опыта задачам/отрасли вакансии) считает
# ТОЛЬКО LLM — детерминированно его не вычислить. Ставку не оцениваем: её
# закрывает калькулятор маржи (lib/compensation), дублировать смысла нет.
WEIGHTS: dict[str, float] = {
    "stack": 0.30,
    "relevance": 0.25,
    "grade": 0.15,
    "experience": 0.15,
    "format": 0.15,
}

CRITERION_LABELS: dict[str, str] = {
    "stack": "Стек",
    "relevance": "Релевантность",
    "grade": "Грейд",
    "experience": "Опыт",
    "format": "Формат",
}

_GRADE_ORDER = {"Junior": 0, "Middle": 1, "Senior": 2, "Lead": 3}
# Ожидаемый опыт (лет) под грейд — грубая эвристика для критерия «опыт».
_GRADE_EXPECTED_YEARS = {"Junior": 1.0, "Middle": 3.0, "Senior": 6.0, "Lead": 8.0}

_MAX_LIST_ITEMS = 6
_MAX_NOTE_LEN = 200
_MAX_SUMMARY_LEN = 600


# === Пороги категории ========================================================
def recommendation_from_score(score: int) -> str:
    if score >= 75:
        return "strong"
    if score >= 50:
        return "good"
    if score >= 25:
        return "weak"
    return "mismatch"


# === Детерминированные критерии =============================================
def _clamp(n: float, lo: float = 0.0, hi: float = 100.0) -> int:
    return int(round(max(lo, min(hi, n))))


def _score_stack(cand: dict[str, Any], vac: dict[str, Any]) -> dict[str, Any] | None:
    required = [s.strip() for s in (vac.get("stack") or []) if str(s).strip()]
    if not required:
        return None  # не можем судить без требований по стеку
    have = {s.strip().lower() for s in (cand.get("stack") or []) if str(s).strip()}
    matched = [r for r in required if r.lower() in have]
    missing = [r for r in required if r.lower() not in have]
    score = _clamp(len(matched) / len(required) * 100)
    if missing:
        note = f"есть {len(matched)}/{len(required)}, нет: " + ", ".join(missing[:5])
    else:
        note = "весь требуемый стек покрыт"
    return {"score": score, "note": note}


def _score_grade(cand: dict[str, Any], vac: dict[str, Any]) -> dict[str, Any] | None:
    c = _GRADE_ORDER.get(cand.get("grade"))
    v = _GRADE_ORDER.get(vac.get("grade"))
    if c is None or v is None:
        return None
    if c >= v:
        note = "грейд совпадает" if c == v else f"{cand['grade']} выше требуемого {vac['grade']}"
        return {"score": 100, "note": note}
    gap = v - c
    score = {1: 60, 2: 30}.get(gap, 10)
    return {"score": score, "note": f"{cand['grade']} при требуемом {vac['grade']}"}


def _score_experience(cand: dict[str, Any], vac: dict[str, Any]) -> dict[str, Any] | None:
    expected = _GRADE_EXPECTED_YEARS.get(vac.get("grade"))
    years = cand.get("experienceYears")
    if expected is None or years is None:
        return None
    try:
        years = float(years)
    except (TypeError, ValueError):
        return None
    score = _clamp(years / expected * 100)
    note = f"{years:g} лет при ориентире ~{expected:g} для {vac.get('grade')}"
    return {"score": score, "note": note}


def _score_format(cand: dict[str, Any], vac: dict[str, Any]) -> dict[str, Any] | None:
    c = cand.get("format")
    v = vac.get("format")
    if not c or not v:
        return None
    if c == v:
        return {"score": 100, "note": f"формат совпадает ({c})"}
    # Гибрид совместим с обоими полюсами лучше, чем «удалёнка vs офис».
    if "Гибрид" in (c, v):
        return {"score": 75, "note": f"{c} vs {v} — частично совместимо"}
    return {"score": 40, "note": f"{c} vs {v} — формат расходится"}


# Примечание: критерий `relevance` (релевантность опыта) умышленно НЕ
# вычисляется детерминированно — его оценивает только LLM (см. score_match).
# Ставку не оцениваем вовсе: её закрывает калькулятор маржи.
_CRITERION_FUNCS = {
    "stack": _score_stack,
    "grade": _score_grade,
    "experience": _score_experience,
    "format": _score_format,
}


def cheap_score(cand: dict[str, Any], vac: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Посчитать детерминированную разбивку по критериям (без LLM).

    Возвращает `{criterion: {"score": int, "weight": float, "note": str}}` —
    только применимые критерии (без данных критерий отбрасывается).
    """
    breakdown: dict[str, dict[str, Any]] = {}
    for key, func in _CRITERION_FUNCS.items():
        res = func(cand, vac)
        if res is None:
            continue
        breakdown[key] = {
            "score": res["score"],
            "weight": WEIGHTS[key],
            "note": res["note"][:_MAX_NOTE_LEN],
        }
    return breakdown


def weighted_total(breakdown: dict[str, dict[str, Any]]) -> int:
    """Итог 0–100 как взвешенная сумма с ренормализацией по присутствующим весам."""
    total_w = sum(c.get("weight", 0) for c in breakdown.values())
    if total_w <= 0:
        return 0
    acc = sum(c.get("score", 0) * c.get("weight", 0) for c in breakdown.values())
    return _clamp(acc / total_w)


def _derive_strengths_gaps(breakdown: dict[str, dict[str, Any]]) -> tuple[list[str], list[str]]:
    """Грубые сильные стороны/пробелы из числовых критериев — для cheap-фоллбэка."""
    strengths = [
        f"{CRITERION_LABELS[k]}: {c['note']}"
        for k, c in breakdown.items()
        if c.get("score", 0) >= 80
    ]
    gaps = [
        f"{CRITERION_LABELS[k]}: {c['note']}"
        for k, c in breakdown.items()
        if c.get("score", 0) < 60
    ]
    return strengths[:_MAX_LIST_ITEMS], gaps[:_MAX_LIST_ITEMS]


# === Хэш входа (кэш) =========================================================
def compute_input_hash(cand: dict[str, Any], vac: dict[str, Any]) -> str:
    """SHA-256 от брифов кандидата+вакансии. Совпал → данные не менялись."""
    payload = f"{vacancy_brief(vac)}\n||\n{candidate_brief(cand)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# === LLM-слой ================================================================
_CRITERION_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {
            "type": "integer",
            "description": "Оценка критерия 0–100, где 100 — идеальное соответствие.",
        },
        "note": {
            "type": "string",
            "description": "Короткое (до ~12 слов) пояснение по-русски: что совпало/не совпало.",
        },
    },
    "additionalProperties": False,
}

SCORE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "stack": {**_CRITERION_SCHEMA, "description": "Соответствие технического стека требованиям вакансии."},
        "relevance": {
            **_CRITERION_SCHEMA,
            "description": (
                "Релевантность РЕАЛЬНОГО опыта задачам и отрасли вакансии: похожие "
                "проекты, домен, тип решаемых задач, специфические требования "
                "(например, интеграции, отраслевые системы) — помимо стека и грейда."
            ),
        },
        "grade": {**_CRITERION_SCHEMA, "description": "Соответствие грейда/уровня."},
        "experience": {**_CRITERION_SCHEMA, "description": "Соответствие опыта по годам."},
        "format": {**_CRITERION_SCHEMA, "description": "Соответствие формата работы (удалёнка/гибрид/офис)."},
        "strengths": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2–4 сильные стороны кандидата ИМЕННО под эту вакансию. Только факты из брифа.",
        },
        "gaps": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2–4 пробела/риска относительно требований. Только факты из брифа.",
        },
        "summary": {
            "type": "string",
            "description": "Вердикт в 2–3 предложениях по-русски: подходит ли и почему. Без выдуманных фактов.",
        },
    },
    "additionalProperties": False,
}

_SYSTEM_PROMPT = """\
Ты — ассистент рекрутингового агентства. Тебе дают бриф ВАКАНСИИ и бриф КАНДИДАТА. \
Оцени, насколько кандидат подходит под вакансию.

Правила:
1. Оценивай СТРОГО по предоставленным брифам. Не выдумывай факты (технологии, \
компании, цифры), которых нет в тексте.
2. По каждому критерию (stack, relevance, grade, experience, format) поставь \
score 0–100 и краткий note по-русски (что именно совпало/не совпало).
   • relevance — насколько РЕАЛЬНЫЙ опыт (проекты, отрасль, тип задач, \
особые требования вроде интеграций/отраслевых систем) соответствует вакансии, \
помимо стека и грейда. Ставку (зарплату) НЕ оценивай.
3. Если по критерию данных нет — поставь умеренный score и честно отметь это в note.
4. strengths и gaps — конкретные пункты под ЭТУ вакансию, не общие слова.
5. summary — 2–3 предложения: подходит ли кандидат и почему.
6. Язык ответа — русский. Названия технологий не переводи.
"""


def _coerce_criterion(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    score = raw.get("score")
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return None
    note = raw.get("note")
    note = note.strip()[:_MAX_NOTE_LEN] if isinstance(note, str) and note.strip() else ""
    return {"score": _clamp(float(score)), "note": note}


def _coerce_str_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out = [s.strip()[:_MAX_NOTE_LEN] for s in raw if isinstance(s, str) and s.strip()]
    return out[:_MAX_LIST_ITEMS]


def _build_result(
    breakdown: dict[str, dict[str, Any]],
    *,
    summary: str | None,
    strengths: list[str],
    gaps: list[str],
    model: str,
    input_hash: str,
) -> dict[str, Any]:
    score = weighted_total(breakdown)
    return {
        "score": score,
        "recommendation": recommendation_from_score(score),
        "breakdown": breakdown,
        "summary": summary,
        "strengths": strengths,
        "gaps": gaps,
        "model": model,
        "input_hash": input_hash,
    }


def cheap_result(cand: dict[str, Any], vac: dict[str, Any]) -> dict[str, Any]:
    """Полный результат скоринга БЕЗ LLM (детерминированный фоллбэк, model='cheap')."""
    breakdown = cheap_score(cand, vac)
    strengths, gaps = _derive_strengths_gaps(breakdown)
    return _build_result(
        breakdown,
        summary=None,
        strengths=strengths,
        gaps=gaps,
        model="cheap",
        input_hash=compute_input_hash(cand, vac),
    )


async def score_match(cand: dict[str, Any], vac: dict[str, Any]) -> dict[str, Any]:
    """Полный AI-скоринг: cheap-база + наложение оценки LLM.

    Может бросить `AiUnavailableError` / `AiBadRequestError` /
    `AiTruncatedJsonError` — ловится в эндпоинте. Если хочешь гарантированный
    результат без исключений — используй `cheap_result`.
    """
    settings = get_settings()
    base = cheap_score(cand, vac)
    input_hash = compute_input_hash(cand, vac)

    user_msg = (
        "=== ВАКАНСИЯ ===\n"
        f"{vacancy_brief(vac)}\n\n"
        "=== КАНДИДАТ ===\n"
        f"{candidate_brief(cand)}"
    )
    max_chars = settings.yandex_ai_max_input_chars
    if len(user_msg) > max_chars:
        user_msg = user_msg[:max_chars]

    client = YandexGptClient()
    raw = await client.json_completion(
        system=_SYSTEM_PROMPT,
        user=user_msg,
        schema_name="match_score",
        schema=SCORE_SCHEMA,
        max_tokens=1500,
        temperature=0.2,
    )

    # Наложение LLM-оценки на детерминированную базу: веса фиксированы (наши),
    # score/note по критерию берём у модели, где она их дала и они валидны.
    merged: dict[str, dict[str, Any]] = {k: dict(v) for k, v in base.items()}
    for key in WEIGHTS:
        crit = _coerce_criterion(raw.get(key))
        if crit is None:
            continue
        if key in merged:
            merged[key]["score"] = crit["score"]
            if crit["note"]:
                merged[key]["note"] = crit["note"]
        else:
            # Критерий, который cheap отбросил (нет структурных данных), но модель
            # смогла оценить из текста — добавляем с его весом.
            merged[key] = {"score": crit["score"], "weight": WEIGHTS[key], "note": crit["note"]}

    if not merged:
        # Совсем нечего оценивать — отдаём cheap-результат как есть.
        return cheap_result(cand, vac)

    strengths = _coerce_str_list(raw.get("strengths"))
    gaps = _coerce_str_list(raw.get("gaps"))
    summary = raw.get("summary")
    summary = summary.strip()[:_MAX_SUMMARY_LEN] if isinstance(summary, str) and summary.strip() else None

    if not strengths and not gaps:
        strengths, gaps = _derive_strengths_gaps(merged)

    return _build_result(
        merged,
        summary=summary,
        strengths=strengths,
        gaps=gaps,
        model=client.model,
        input_hash=input_hash,
    )


__all__ = [
    "AiBadRequestError",
    "AiTruncatedJsonError",
    "AiUnavailableError",
    "SCORE_SCHEMA",
    "WEIGHTS",
    "cheap_result",
    "cheap_score",
    "compute_input_hash",
    "recommendation_from_score",
    "score_match",
    "weighted_total",
]
