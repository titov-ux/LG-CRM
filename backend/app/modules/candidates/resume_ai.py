"""AI-адаптация резюме кандидата под конкретную вакансию.

Используем YandexGPT через `app.integrations.yandex_gpt`. Контракт: модель
получает на вход (1) ключевые поля кандидата (summary, навыки, опыт, стек) и
(2) ключевые поля вакансии (заголовок, требования, описание, стек, грейд) и
возвращает «улучшенную» версию подмножества полей кандидата:

  • summary           — переписанное сопроводительное (1 короткий абзац, релевантный
                        вакансии);
  • experienceYears   — кол-во лет релевантного опыта (число, может скорректироваться
                        с учётом контекста вакансии — но НЕ выдумывать);
  • stack             — переупорядоченный/подчищенный плоский список технологий
                        (релевантные вакансии — впереди, лишние можно убрать);
  • skillCategories   — категории навыков с тем же приоритетом;
  • experience        — те же места работы (нельзя «выдумывать новые компании»),
                        но `project` и `achievements` могут быть переписаны с
                        акцентом на технологии/задачи из вакансии. Список
                        обязательно той же длины и в том же порядке, что у
                        кандидата (мы мерджим по индексу).

Жёсткие правила:
  1. Не добавлять опыта, которого не было (компании/должности/даты не трогать).
  2. Никаких длинных тире «—» — рендер не дружит с ними.
  3. Сохранять язык оригинала (как правило, русский).
  4. Если кандидат явно не подходит — всё равно вернуть аккуратную адаптацию
     (правило «не врать», но «выжать максимум из реального опыта»).

Ошибки нормализованы:
  • `AiUnavailableError` — нет ключа / 5xx / сеть / битый JSON → 503 в эндпоинте.
  • `AiBadRequestError` — 4xx от Yandex → 502 в эндпоинте.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.core.config import get_settings
from app.integrations.yandex_gpt import (
    AiBadRequestError,
    AiUnavailableError,
    YandexGptClient,
)
from app.modules.candidates.briefs import candidate_brief, vacancy_brief

logger = logging.getLogger(__name__)


# JSON-схема ответа модели. Поля камелКейсные — фронт мерджит их в Candidate.
# `experience` — массив той же длины, что и у кандидата; модель не имеет права
# его укорачивать или удлинять. Если модель ошиблась — мы это проверяем в
# `_coerce_improvement` (см. ниже) и при расхождении длины откатываемся к
# оригинальному списку.
IMPROVED_RESUME_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": (
                "Сопроводительное письмо / 'обо мне', переписанное под вакансию. "
                "Один абзац (3-6 предложений), без воды, без длинных тире. "
                "Подсвечивает релевантный опыт и технологии из вакансии. "
                "Никогда не выдумывать факты (компании, должности, цифры)."
            ),
        },
        "experienceYears": {
            "type": "number",
            "description": (
                "Кол-во лет ОБЩЕГО опыта (число с плавающей точкой). "
                "По умолчанию — оставляй как у кандидата. Менять можно только "
                "если в оригинальном опыте видно, что число занижено/завышено."
            ),
        },
        "stack": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Плоский список технологий кандидата. Можно переупорядочить "
                "(релевантные вакансии — впереди), можно убрать явно неуместные "
                "лишние, но НИЧЕГО НЕ ВЫДУМЫВАТЬ. Сохраняй каноничные имена "
                "(PostgreSQL, не postgres)."
            ),
        },
        "skillCategories": {
            "type": "array",
            "description": (
                "Категории навыков. Та же структура, что у кандидата. Можно "
                "переупорядочить категории и элементы внутри них, можно "
                "переименовать категории. Не добавлять новые элементы, которых "
                "нет в оригинале."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "items": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "items"],
                "additionalProperties": False,
            },
        },
        "experience": {
            "type": "array",
            "description": (
                "Места работы кандидата — ТО ЖЕ количество и тот же ПОРЯДОК. "
                "Менять можно только `project` (описание проекта) и `achievements` "
                "(буллеты задач/достижений) — переписать их с акцентом на технологии "
                "и задачи из вакансии. company, position, startMonth, endMonth, stack "
                "оставляй как есть."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "project": {"type": "string"},
                    "achievements": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["project", "achievements"],
                "additionalProperties": False,
            },
        },
    },
    "additionalProperties": False,
}


_SYSTEM_PROMPT = """\
Ты — помощник CRM рекрутингового агентства. Тебе дают (1) резюме кандидата и \
(2) описание вакансии. Твоя задача — адаптировать резюме под вакансию: \
переписать сопроводительное, переставить навыки/стек в порядке релевантности \
вакансии, переписать описания опыта работы с акцентом на технологии и задачи \
из вакансии.

Жёсткие правила:
1. НИЧЕГО НЕ ВЫДУМЫВАТЬ. Нельзя добавлять компании, должности, технологии, \
которых не было в оригинале. Можно только переформулировать и переставлять.
2. Список мест работы (experience) должен остаться в ТОМ ЖЕ количестве и в \
ТОМ ЖЕ порядке, что у кандидата. Менять можно только `project` и `achievements`.
3. Никаких длинных тире «—», только дефис «-». Никаких «по настоящее время».
4. Сохраняй язык оригинала (обычно русский). Не переводи названия технологий.
5. Сопроводительное (`summary`) — один абзац 3-6 предложений, конкретно, без \
маркетинговой воды и без перечисления всего стека списком.
6. Возвращай ТОЛЬКО те поля, которые реально стоит изменить. Если в каком-то \
поле улучшать нечего — не включай его в ответ.
"""


# Брифы кандидата/вакансии вынесены в общий модуль и переиспользуются скорингом
# (`matching/ai.py`). Здесь оставлены приватные алиасы ради читаемости ниже.
_candidate_brief = candidate_brief
_vacancy_brief = vacancy_brief


def _strip_em_dashes(value: Any) -> Any:
    """Заменить em/en-dash на обычный дефис в строке (рендер не дружит с ними)."""
    if isinstance(value, str):
        return value.replace("—", "-").replace("–", "-").replace("―", "-")
    return value


def _coerce_improvement(
    raw: dict[str, Any],
    *,
    original_experience: list[dict[str, Any]],
) -> dict[str, Any]:
    """Нормализация ответа LLM в финальный dict.

    • `experience` — оставляем строго той же длины, что у кандидата. Если модель
      вернула не столько — игнорируем поле целиком (фронт оставит оригинал).
    • Поля с пустыми значениями отбрасываем — это легче для merge на фронте.
    """
    out: dict[str, Any] = {}

    summary = raw.get("summary")
    if isinstance(summary, str) and summary.strip():
        out["summary"] = _strip_em_dashes(summary.strip())

    years = raw.get("experienceYears")
    if isinstance(years, (int, float)) and not isinstance(years, bool) and years >= 0:
        out["experienceYears"] = float(years)

    stack = raw.get("stack")
    if isinstance(stack, list):
        clean_stack = [
            _strip_em_dashes(s).strip()
            for s in stack
            if isinstance(s, str) and s.strip()
        ]
        if clean_stack:
            out["stack"] = clean_stack

    skill_cats = raw.get("skillCategories")
    if isinstance(skill_cats, list):
        clean_cats: list[dict[str, Any]] = []
        for cat in skill_cats:
            if not isinstance(cat, dict):
                continue
            name = cat.get("name")
            items = cat.get("items")
            if not isinstance(name, str) or not name.strip():
                continue
            if not isinstance(items, list):
                continue
            clean_items = [
                _strip_em_dashes(it).strip()
                for it in items
                if isinstance(it, str) and it.strip()
            ]
            if not clean_items:
                continue
            clean_cats.append(
                {"name": _strip_em_dashes(name.strip()), "items": clean_items}
            )
        if clean_cats:
            out["skillCategories"] = clean_cats

    exp = raw.get("experience")
    if (
        isinstance(exp, list)
        and len(exp) == len(original_experience)
        and len(exp) > 0
    ):
        clean_exp: list[dict[str, Any]] = []
        for i, e in enumerate(exp):
            if not isinstance(e, dict):
                clean_exp.append({})
                continue
            patch: dict[str, Any] = {}
            project = e.get("project")
            if isinstance(project, str) and project.strip():
                patch["project"] = _strip_em_dashes(project.strip())
            achievements = e.get("achievements")
            if isinstance(achievements, list):
                clean_ach = [
                    _strip_em_dashes(a).strip()
                    for a in achievements
                    if isinstance(a, str) and a.strip()
                ]
                if clean_ach:
                    patch["achievements"] = clean_ach
            clean_exp.append(patch)
        # Хоть один блок должен реально содержать улучшение, иначе нет смысла.
        if any(clean_exp):
            out["experience"] = clean_exp
    elif isinstance(exp, list) and len(exp) != len(original_experience):
        logger.warning(
            "resume_ai: experience length mismatch (model=%d, original=%d) — dropping",
            len(exp),
            len(original_experience),
        )

    return out


async def improve_resume_for_vacancy(
    *,
    candidate_payload: dict[str, Any],
    vacancy_payload: dict[str, Any],
) -> dict[str, Any]:
    """Получить от YandexGPT адаптированную версию полей резюме под вакансию.

    Возвращает dict с camelCase-ключами, готовый к мерджу с Candidate на фронте.
    Возможные ключи: `summary`, `experienceYears`, `stack`, `skillCategories`,
    `experience` (тот же порядок и длина, что у кандидата).

    Может бросить `AiUnavailableError` / `AiBadRequestError` — ловится в эндпоинте.
    """
    settings = get_settings()
    max_chars = settings.yandex_ai_max_input_chars

    cand_brief = _candidate_brief(candidate_payload)
    vac_brief = _vacancy_brief(vacancy_payload)
    user_msg = (
        "=== ВАКАНСИЯ ===\n"
        f"{vac_brief}\n\n"
        "=== КАНДИДАТ ===\n"
        f"{cand_brief}"
    )
    if len(user_msg) > max_chars:
        user_msg = user_msg[:max_chars]

    original_exp = candidate_payload.get("experience") or []

    client = YandexGptClient()
    raw = await client.json_completion(
        system=_SYSTEM_PROMPT,
        user=user_msg,
        schema_name="improved_resume",
        schema=IMPROVED_RESUME_SCHEMA,
        max_tokens=3500,
        temperature=0.3,
    )
    logger.debug(
        "resume_ai raw response: %s",
        json.dumps(raw, ensure_ascii=False)[:2000],
    )
    return _coerce_improvement(raw, original_experience=original_exp)


__all__ = [
    "AiBadRequestError",
    "AiUnavailableError",
    "IMPROVED_RESUME_SCHEMA",
    "improve_resume_for_vacancy",
]
