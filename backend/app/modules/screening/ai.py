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

PROMPT_VERSION = "screening_questions_v3"

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
                "Только глубокие технические вопросы (знание стека/инструментов/"
                "механизмов). Без behavioral STAR и HR. "
                f"Обычно {_DEFAULT_COUNT} штук, не меньше {_MIN_COUNT} и не больше {_MAX_COUNT}."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": (
                            "Технический вопрос: в тексте есть конкретный термин "
                            "из стека/требований; проверяет механизм, параметры, "
                            "trade-off или критерий оценки. На русском. "
                            "Не начинай с 'Вопрос N:'."
                        ),
                    },
                    "goal": {
                        "type": "string",
                        "description": (
                            "Какое техническое знание проверяем "
                            "(например: 'JVM GC и паузы', 'индексы PostgreSQL'). "
                            "Без soft skills."
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
Ты составляешь чек-лист для технического скрининга. Только вопросы на \
проверяемое техническое знание по стеку и требованиям вакансии / резюме.

Что считать «техническим»: механизм, устройство, параметры, ограничения, \
сравнение технологий, критерии оценки артефакта. Ответ можно оценить как \
верный/слабый по сути, а не по storytelling.

Жёсткие запреты (ни одного такого вопроса):
- behavioral STAR: «расскажите о ситуации / кейсе / периоде / самом сложном»;
- HR: мотивация, зарплата, формат работы, cultural fit, «расскажите о себе»;
- организация нагрузки, работа с заказчиком/клиентом, «как выстраиваете процесс» \
без разбора конкретного технического механизма;
- общие «какие инструменты/каналы используете?» без требования устройства.

Обязательные правила для КАЖДОГО вопроса:
1. В тексте вопроса должен быть конкретный термин из стека, требований или \
резюме (технология, протокол, инструмент, паттерн).
2. Вопрос копает глубже названия: как работает / почему так / чем отличается \
от альтернативы / какие trade-offs / как диагностировать проблему.
3. Не переспрашивай факты, уже явно написанные в резюме одной строкой.
4. Один вопрос = одна техническая компетенция; `goal` называет её предметно.
5. Если вакансии нет — по роли и стеку из резюме.
6. Не выдумывай факты. Без юридических и дискриминационных вопросов.
7. Верни ровно {count} вопросов.

Примеры плохо → хорошо:
Плохо: «Расскажите о сложном кейсе и как справились.»
Хорошо: «Чем at-least-once отличается от exactly-once в Kafka и какой \
ценой даётся exactly-once на продюсере/консьюмере?»
Плохо: «Как организуете работу / процесс?»
Хорошо: «По каким техническим критериям отличите Middle и Senior в стеке \
вакансии? Назовите 3 проверяемых признака.»
Плохо: «Расскажите об опыте с PostgreSQL.»
Хорошо: «Когда B-tree индекс в PostgreSQL не поможет SELECT с LIKE '%…%' и \
что использовать вместо него?»
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
    parts.append(
        "=== ЗАДАЧА ===\n"
        f"Составь ровно {count} глубоких технических вопросов. "
        "Запрещены behavioral STAR и HR. Каждый вопрос — про механизм/"
        "стек/инструмент из брифа выше."
    )
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
        temperature=0.2,
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
