"""Генерация плана вопросов для AI-скрининга до встречи (Этап 3).

YandexGPT + `response_format=json_schema` → список вопросов с целью каждого.
Контекст: брифы кандидата и вакансии из `candidates/briefs.py` (те же, что
для скоринга и адаптации резюме).

Ошибки `AiUnavailableError` / `AiBadRequestError` пробрасываются наверх —
эндпоинт мапит их в 503 / 502 по общему паттерну проекта.
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

logger = logging.getLogger(__name__)

PROMPT_VERSION = "screening_questions_v1"

# Сколько вопросов просим у модели по умолчанию (скрининг 20–40 мин).
_DEFAULT_COUNT = 8
_MIN_COUNT = 5
_MAX_COUNT = 12

QUESTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "description": (
                "План вопросов скрининга по порядку озвучивания. "
                f"Обычно {_DEFAULT_COUNT} штук, не меньше {_MIN_COUNT} и не больше {_MAX_COUNT}."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": (
                            "Формулировка вопроса кандидату от лица рекрутера. "
                            "Открытый вопрос, на русском, без канцелярита. "
                            "Не начинай с 'Вопрос N:'."
                        ),
                    },
                    "goal": {
                        "type": "string",
                        "description": (
                            "Зачем задаём: что проверяем (компетенция, мотивация, "
                            "риски, культурный fit). Одна короткая фраза для рекрутера."
                        ),
                    },
                },
                "required": ["text", "goal"],
                "additionalProperties": False,
            },
            "minItems": _MIN_COUNT,
            "maxItems": _MAX_COUNT,
        }
    },
    "required": ["questions"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = """\
Ты — помощник рекрутера IT-агентства. Составь план вопросов для короткого \
видеоскрининга (20–40 минут) кандидата под вакансию.

Правила:
1. Вопросы на русском, открытые, по делу. Без «расскажите о себе» как первого \
и единственного — лучше конкретнее (опыт, проекты, стек, мотивация, формат).
2. Покрой: релевантный опыт и проекты; hard skills / стек вакансии; мотивацию \
и причины поиска; условия (формат, ставка/ожидания — мягко); риски \
(пробелы в резюме, джоб-хоппинг, несовпадение грейда).
3. Учитывай резюме: не спрашивай то, что уже однозначно видно; углубляйся \
в спорные места и в требования вакансии, которых в резюме мало.
4. Если вакансии нет — общий скрининг по роли и опыту кандидата.
5. У каждого вопроса обязательна короткая `goal` — подсказка рекрутеру, \
что именно проверяем.
6. Не выдумывай факты о кандидате или компании. Не включай юридические \
и дискриминационные вопросы.
7. Верни ровно {count} вопросов (если данных мало — всё равно {count}, \
но более общие и полезные).
"""


def _clean_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v or v.lower() in {"null", "none", "n/a"}:
        return None
    return v


def _coerce_questions(raw: dict[str, Any]) -> list[dict[str, str]]:
    """Нормализовать ответ модели → [{text, goal}, ...]."""
    items = raw.get("questions")
    if not isinstance(items, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        text = _clean_str(item.get("text"))
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        goal = _clean_str(item.get("goal"))
        out.append({"text": text, "goal": goal or "Уточнить опыт кандидата"})
        if len(out) >= _MAX_COUNT:
            break
    return out


async def generate_screening_questions(
    *,
    candidate_payload: dict[str, Any],
    vacancy_payload: dict[str, Any] | None = None,
    count: int = _DEFAULT_COUNT,
) -> list[dict[str, str]]:
    """Сгенерировать план вопросов. Может бросить AiUnavailable/AiBadRequest."""
    count = max(_MIN_COUNT, min(_MAX_COUNT, int(count)))
    settings = get_settings()
    max_chars = settings.yandex_ai_max_input_chars

    cand_brief = candidate_brief(candidate_payload)
    parts = ["=== КАНДИДАТ ===\n" + cand_brief]
    if vacancy_payload:
        parts.insert(0, "=== ВАКАНСИЯ ===\n" + vacancy_brief(vacancy_payload))
    else:
        parts.insert(0, "=== ВАКАНСИЯ ===\nНе указана — общий скрининг по роли кандидата.")
    user_msg = "\n\n".join(parts)
    if len(user_msg) > max_chars:
        user_msg = user_msg[:max_chars]

    client = YandexGptClient()
    raw = await client.json_completion(
        system=_SYSTEM_PROMPT.format(count=count),
        user=user_msg,
        schema_name="screening_questions",
        schema=QUESTIONS_SCHEMA,
        max_tokens=2500,
        temperature=0.4,
    )
    questions = _coerce_questions(raw)
    if len(questions) < _MIN_COUNT:
        logger.warning(
            "screening.ai: too few questions after coerce (%d): %s",
            len(questions),
            raw,
        )
        raise AiUnavailableError(
            f"model returned fewer than {_MIN_COUNT} usable questions"
        )
    return questions


__all__ = [
    "PROMPT_VERSION",
    "QUESTIONS_SCHEMA",
    "AiBadRequestError",
    "AiUnavailableError",
    "generate_screening_questions",
]
