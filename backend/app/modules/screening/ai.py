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

PROMPT_VERSION = "screening_questions_v4"

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
                "Глубокие операционные техвопросы (механизм, диагностика, "
                "trade-off). Без STAR, HR и энциклопедических определений. "
                f"Обычно {_DEFAULT_COUNT} штук, не меньше {_MIN_COUNT} и не больше {_MAX_COUNT}."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": (
                            "Операционный техвопрос: термин из брифа + как "
                            "проверить/настроить/диагностировать/выбрать. "
                            "Не определение и не список плюсов. На русском."
                        ),
                    },
                    "goal": {
                        "type": "string",
                        "description": (
                            "Предметная техкомпетенция "
                            "(например: 'диагностика consumer lag в Kafka')."
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
Составь чек-лист технического скрининга: только операционные вопросы по \
стеку и требованиям из брифа. Ответ должен показывать, КАК кандидат \
работает с технологией, а не что он запомнил из вики.

Жёсткие запреты:
- STAR / кейсы / «расскажите о ситуации»;
- HR: мотивация, зарплата, формат, fit, «о себе»;
- энциклопедия: «чем отличаются роли A/B/C», «перечислите задачи/навыки», \
«плюсы и минусы инструмента», «какие ключевые функции у X», «в чём \
разница DevOps и QA» без разбора конкретного механизма проверки;
- общие обзоры инструментов без параметров, команд, критериев, edge-case.

Каждый вопрос обязан:
1. Содержать конкретный термин из стека/требований/резюме.
2. Требовать операционную глубину: как проверить на практике, как \
диагностировать сбой, какой параметр/критерий выбрать и почему, какой \
edge-case ломает наивный подход.
3. Быть оцениваемым по сути (верный/слабый), не по красоте рассказа.
4. Не дублировать факты, уже явно написанные в резюме.
5. Одна компетенция на вопрос; `goal` предметный.
6. Без вакансии — по роли и стеку резюме.
7. Не выдумывать факты. Без юр. и дискриминационных вопросов.
8. Ровно {count} вопросов.

Плохо → хорошо:
Плохо: «Чем отличаются data analyst, scientist и engineer?»
Хорошо: «Кандидат пишет в резюме Airflow + Spark. Какие 3 вопроса зададите, \
чтобы отличить реальное владение DAG/партициями от копипаста стека?»
Плохо: «Плюсы HH.ru vs LinkedIn?»
Хорошо: «Нужен Senior Go с Kubernetes, пассивный поиск. Какой поисковый \
запрос/фильтры на выбранной площадке составите и что отсеете первыми?»
Плохо: «Какие функции должны быть в ATS?»
Хорошо: «Как в ATS (из опыта кандидата) настроите этапы воронки и какие \
2 метрики смотрите weekly, чтобы поймать просадку conversion offer→accept?»
Плохо: «Расскажите об опыте с PostgreSQL.»
Хорошо: «Когда B-tree не помогает LIKE '%…%' в PostgreSQL и что ставить \
вместо него?»
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
        f"Составь ровно {count} операционных технических вопросов. "
        "Запрещены STAR, HR и энциклопедия («чем отличаются», «плюсы/минусы», "
        "«перечислите функции»). Каждый вопрос — как проверить/настроить/"
        "диагностировать по терминам из брифа."
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
