"""Пост-анализ сессии скрининга → отчёт (Этап 5).

После «Завершить» Celery / in-process задача собирает транскрипт + чек-лист +
брифы кандидата/вакансии и просит YandexGPT structured JSON: summary, scores
по компетенциям, red_flags, verdict, recommendation.
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.config import get_settings
from app.integrations.yandex_gpt import (
    AiBadRequestError,
    AiUnavailableError,
    YandexGptClient,
)
from app.modules.candidates.briefs import candidate_brief, vacancy_brief
from app.modules.screening.models import ScreeningVerdict

logger = logging.getLogger(__name__)

PROMPT_VERSION = "screening_report_v1"

# Рубрики скоринга (1–5). Открытый вопрос плана закрываем фиксированным набором
# для скрининга IT; при необходимости расширим без миграции (JSONB).
SCORE_KEYS = (
    "communication",
    "motivation",
    "hard_skills",
    "experience_fit",
    "culture_fit",
)

_SCORE_LABELS_RU = {
    "communication": "Коммуникация",
    "motivation": "Мотивация",
    "hard_skills": "Hard skills",
    "experience_fit": "Релевантный опыт",
    "culture_fit": "Культурный fit",
}

_CRITERION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "score": {
            "type": "integer",
            "description": "Оценка 1–5 (1 — слабо, 5 — отлично).",
        },
        "note": {
            "type": "string",
            "description": "Короткое пояснение по-русски (до ~20 слов) по фактам из транскрипта.",
        },
    },
    "required": ["score", "note"],
    "additionalProperties": False,
}

REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "Резюме беседы: 3–6 предложений по-русски. Только факты из транскрипта.",
        },
        "verdict": {
            "type": "string",
            "enum": ["fit", "partial_fit", "no_fit"],
            "description": (
                "fit — рекомендовать дальше; partial_fit — с оговорками; "
                "no_fit — не подходит под вакансию/роль."
            ),
        },
        "scores": {
            "type": "object",
            "properties": {key: _CRITERION_SCHEMA for key in SCORE_KEYS},
            "required": list(SCORE_KEYS),
            "additionalProperties": False,
        },
        "red_flags": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "0–6 красных флагов (риски, противоречия, пробелы). "
                "Пустой массив, если нет."
            ),
        },
        "recommendation": {
            "type": "string",
            "description": (
                "Практическая рекомендация рекрутеру: следующий шаг "
                "(техническое, отказ, уточнить X). 1–3 предложения."
            ),
        },
    },
    "required": ["summary", "verdict", "scores", "red_flags", "recommendation"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = """\
Ты — ассистент рекрутингового агентства. По транскрипту видеоскрининга и \
контексту кандидата/вакансии составь итоговый отчёт для рекрутера.

Правила:
1. Опирайся ТОЛЬКО на транскрипт и брифы. Не выдумывай факты, компании, цифры.
2. Если данных мало — честно отрази это в summary и снизь оценки; verdict тогда \
чаще partial_fit или no_fit.
3. scores — пять компетенций (1–5) с кратким note по фактам разговора:
   communication, motivation, hard_skills, experience_fit, culture_fit.
4. red_flags — конкретные риски (джоб-хоппинг, завышенные ожидания, пробелы в \
стеке, уклончивость). Не выдумывай; пустой список, если флагов нет.
5. verdict: fit / partial_fit / no_fit относительно вакансии (если вакансии нет — \
относительно заявленной роли кандидата).
6. recommendation — что делать дальше рекрутеру.
7. Язык ответа — русский. Названия технологий не переводи.
"""

_MAX_NOTE = 240
_MAX_FLAG = 200
_MAX_FLAGS = 6
_MAX_SUMMARY = 4000
_MAX_RECOMMENDATION = 1500


def _clean_str(value: Any, *, max_len: int) -> str | None:
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v or v.lower() in {"null", "none", "n/a"}:
        return None
    return v[:max_len]


def _clamp_score(raw: Any) -> int | None:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return max(1, min(5, int(round(float(raw)))))


def _coerce_scores(raw: Any) -> dict[str, dict[str, Any]]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, dict[str, Any]] = {}
    for key in SCORE_KEYS:
        item = src.get(key)
        score = _clamp_score(item.get("score") if isinstance(item, dict) else None)
        if score is None:
            score = 3
        note = ""
        if isinstance(item, dict):
            note = _clean_str(item.get("note"), max_len=_MAX_NOTE) or ""
        out[key] = {"score": score, "note": note}
    return out


def _coerce_verdict(raw: Any) -> ScreeningVerdict:
    if isinstance(raw, str):
        try:
            return ScreeningVerdict(raw.strip())
        except ValueError:
            pass
    return ScreeningVerdict.partial_fit


def coerce_report(raw: dict[str, Any]) -> dict[str, Any]:
    """Нормализовать ответ модели → поля ScreeningReport (+ model/prompt_version снаружи)."""
    summary = _clean_str(raw.get("summary"), max_len=_MAX_SUMMARY) or (
        "Недостаточно данных для развёрнутого резюме беседы."
    )
    recommendation = _clean_str(raw.get("recommendation"), max_len=_MAX_RECOMMENDATION)
    flags_raw = raw.get("red_flags")
    red_flags: list[str] = []
    if isinstance(flags_raw, list):
        for item in flags_raw:
            flag = _clean_str(item, max_len=_MAX_FLAG)
            if flag and flag not in red_flags:
                red_flags.append(flag)
            if len(red_flags) >= _MAX_FLAGS:
                break
    return {
        "summary": summary,
        "verdict": _coerce_verdict(raw.get("verdict")),
        "scores": _coerce_scores(raw.get("scores")),
        "red_flags": red_flags,
        "recommendation": recommendation,
    }


def fallback_report(
    *,
    transcript_chars: int,
    answered_questions: int,
    total_questions: int,
) -> dict[str, Any]:
    """Детерминированный отчёт без LLM (нет ключа / сбой AI / пустой транскрипт)."""
    if transcript_chars < 40:
        summary = (
            "Транскрипт встречи почти пуст — AI-анализ недоступен. "
            "Проверьте запись и при необходимости перепроведите скрининг."
        )
        verdict = ScreeningVerdict.partial_fit
        recommendation = (
            "Не опирайтесь на автоматический вердикт: пересмотрите запись вручную "
            "или повторите встречу с корректным захватом звука."
        )
        score = 2
    else:
        summary = (
            f"Автоматический AI-отчёт недоступен. В транскрипте ~{transcript_chars} "
            f"символов; по чек-листу отвечено {answered_questions} из {total_questions} "
            "вопросов. Ниже — нейтральные оценки-заглушки."
        )
        verdict = ScreeningVerdict.partial_fit
        recommendation = (
            "Дождитесь восстановления AI или составьте вердикт вручную по транскрипту "
            "и чек-листу вопросов."
        )
        score = 3
    scores = {
        key: {
            "score": score,
            "note": f"{_SCORE_LABELS_RU[key]}: оценка-заглушка (без LLM).",
        }
        for key in SCORE_KEYS
    }
    return {
        "summary": summary,
        "verdict": verdict,
        "scores": scores,
        "red_flags": [],
        "recommendation": recommendation,
        "model": "fallback",
        "prompt_version": PROMPT_VERSION,
    }


def _format_transcript(
    segments: list[dict[str, Any]], *, max_chars: int
) -> str:
    lines: list[str] = []
    for seg in segments:
        speaker = seg.get("speaker") or "?"
        label = "Рекрутер" if speaker == "recruiter" else "Кандидат"
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        lines.append(f"[{label}] {text}")
    body = "\n".join(lines) if lines else "(транскрипт пуст)"
    if len(body) > max_chars:
        body = body[: max_chars - 20] + "\n…[обрезано]"
    return body


def _format_questions(questions: list[dict[str, Any]]) -> str:
    if not questions:
        return "(чек-лист пуст)"
    lines: list[str] = []
    for q in questions:
        status = q.get("status") or "pending"
        text = (q.get("text") or "").strip()
        summary = (q.get("answer_summary") or "").strip()
        line = f"- [{status}] {text}"
        if summary:
            line += f" → ответ: {summary}"
        lines.append(line)
    return "\n".join(lines)


async def generate_screening_report(
    *,
    candidate_payload: dict[str, Any],
    vacancy_payload: dict[str, Any] | None,
    questions: list[dict[str, Any]],
    segments: list[dict[str, Any]],
) -> dict[str, Any]:
    """Сгенерировать отчёт. Может бросить AiUnavailable/AiBadRequest."""
    settings = get_settings()
    max_chars = settings.yandex_ai_max_input_chars
    # Транскрипт — основной объём; брифы режем пропорционально.
    transcript_budget = max(4000, int(max_chars * 0.65))
    brief_budget = max(2000, max_chars - transcript_budget - 2000)

    cand_brief = candidate_brief(candidate_payload)
    vac_part = (
        vacancy_brief(vacancy_payload)
        if vacancy_payload
        else "Не указана — оценивай относительно роли кандидата."
    )
    briefs = (
        f"=== ВАКАНСИЯ ===\n{vac_part}\n\n=== КАНДИДАТ ===\n{cand_brief}"
    )
    if len(briefs) > brief_budget:
        briefs = briefs[:brief_budget]

    user_msg = "\n\n".join(
        [
            briefs,
            "=== ЧЕК-ЛИСТ ВОПРОСОВ ===\n" + _format_questions(questions),
            "=== ТРАНСКРИПТ ===\n"
            + _format_transcript(segments, max_chars=transcript_budget),
        ]
    )
    if len(user_msg) > max_chars:
        user_msg = user_msg[:max_chars]

    client = YandexGptClient()
    raw = await client.json_completion(
        system=_SYSTEM_PROMPT,
        user=user_msg,
        schema_name="screening_report",
        schema=REPORT_SCHEMA,
        max_tokens=3500,
        temperature=0.2,
    )
    coerced = coerce_report(raw if isinstance(raw, dict) else {})
    coerced["model"] = client.model
    coerced["prompt_version"] = PROMPT_VERSION
    return coerced


__all__ = [
    "PROMPT_VERSION",
    "REPORT_SCHEMA",
    "SCORE_KEYS",
    "AiBadRequestError",
    "AiUnavailableError",
    "coerce_report",
    "fallback_report",
    "generate_screening_report",
]
