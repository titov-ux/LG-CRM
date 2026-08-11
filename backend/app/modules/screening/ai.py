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

PROMPT_VERSION = "screening_questions_v2"

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
                "План глубоких технических вопросов скрининга по порядку. "
                f"Обычно {_DEFAULT_COUNT} штук, не меньше {_MIN_COUNT} и не больше {_MAX_COUNT}."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": (
                            "Глубокий технический / профессиональный вопрос кандидату. "
                            "На русском, открытый, с опорой на конкретный стек, "
                            "инструмент, кейс или требование вакансии. "
                            "Не начинай с 'Вопрос N:'."
                        ),
                    },
                    "goal": {
                        "type": "string",
                        "description": (
                            "Какую hard skill / техническую компетенцию проверяем. "
                            "Одна короткая фраза для рекрутера — без мотивации и soft skills."
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
Ты — технический интервьюер IT-агентства. Составь план ТОЛЬКО технических \
вопросов для видеоскрининга (20–40 минут) кандидата под вакансию.

Цель: проверить глубину hard skills и предметной экспертизы роли. Не HR-скрининг.

Правила:
1. Только технические / профессиональные вопросы по стеку, инструментам, \
методам работы и домену вакансии. Вопросы на русском, открытые, конкретные.
2. Глубина обязательна: проси trade-offs, «как именно», метрики, разбор \
ошибок, сравнение подходов, ограничения инструментов. Запрещены общие \
вопросы вроде «какие методы используете?» без уточнения контекста.
3. Опирайся на must-have вакансии и на заявленный в резюме опыт: углубляйся \
в то, что кандидат указал, и в пробелы относительно требований. Не \
переспрашивай факты, которые уже однозначно видны в резюме.
4. ЗАПРЕЩЕНО включать: мотивацию («почему эта вакансия / смена работы»), \
формат работы, зарплату и условия, «расскажите о себе», культурный fit, \
тайм-менеджмент без привязки к техпроцессу, мягкие HR-вопросы.
5. Фокус: архитектура, стек и инструменты роли, продакшен-кейсы, отладка, \
качество, ограничения и выбор решений — строго по требованиям вакансии \
и заявленному опыту.
6. Каждый вопрос — одна проверяемая техническая компетенция; `goal` \
называет её явно (например: «понимание микросервисов», «опыт с Kafka»).
7. Если вакансии нет — глубокий техскрининг по роли и стеку из резюме.
8. Не выдумывай факты о кандидате или компании. Без юридических и \
дискриминационных вопросов.
9. Верни ровно {count} вопросов (если данных мало — всё равно {count}, \
но технические и полезные для роли).
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
