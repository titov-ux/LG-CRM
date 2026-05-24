"""AI-распознавание брифа вакансии → структурированные поля формы.

Используем YandexGPT через `app.integrations.yandex_gpt`. Модель вызывается с
`response_format=json_schema` — она ОБЯЗАНА вернуть JSON по нашей схеме.

Контракт ответа (см. фронт `frontend/src/features/vacancies/types.ts`):

    interface ParsedVacancy {
      title?:        string
      project?:      string
      grade?:        'Junior' | 'Middle' | 'Senior' | 'Lead'
      format?:       'Удалённо' | 'Гибрид' | 'Офис'
      priority?:     'low' | 'medium' | 'high' | 'urgent'
      rateClient?:   number       // ₽/час
      deadline?:     string       // YYYY-MM-DD
      stack?:        string       // CSV-список технологий
      description?:  string
      requirements?: string
    }

Все поля опциональны: модель должна возвращать только то, что явно следует из
текста. Если ничего не распозналось — вернуть пустой объект.
"""
from __future__ import annotations

from typing import Any

from app.core.config import get_settings
from app.integrations.yandex_gpt import (
    AiBadRequestError,
    AiUnavailableError,
    YandexGptClient,
)
from app.modules.vacancies.models import Grade, Priority, WorkFormat

# JSON schema для tool_use. Описания важны — модель смотрит на них, чтобы понять,
# какие значения «правильные».
PARSED_VACANCY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "description": (
                "Краткое название вакансии (роль), например 'Senior Backend (Java)'. "
                "Без названия компании, без хвостов вроде 'в финтех-компанию'. "
                "Если в тексте только описание задач — попытайся вывести роль."
            ),
        },
        "project": {
            "type": "string",
            "description": "Название проекта/продукта, если упомянуто.",
        },
        "grade": {
            "type": "string",
            "enum": [g.value for g in Grade],
            "description": (
                "Уровень кандидата. Middle+ относи к Senior, Tech Lead / Team Lead к Lead."
            ),
        },
        "format": {
            "type": "string",
            "enum": [f.value for f in WorkFormat],
            "description": (
                "Формат работы. 'Удалённо' для remote/удалёнки, 'Гибрид' для hybrid, "
                "'Офис' для on-site."
            ),
        },
        "priority": {
            "type": "string",
            "enum": [p.value for p in Priority],
            "description": (
                "Приоритет вакансии. 'urgent' если в тексте 'срочно', 'asap', "
                "'критично'. 'high' для 'высокий приоритет'. Иначе не указывай."
            ),
        },
        "rateClient": {
            "type": "number",
            "description": (
                "Ставка для клиента в ₽/час (число). Если указан диапазон — "
                "берётся верхняя граница. Если указано 'обсуждается', 'по рынку', "
                "'смотрим' — не заполняй. Если в тексте оклад/зарплата за месяц — "
                "тоже не заполняй (это другое поле, salary_max, которое мы здесь не парсим)."
            ),
        },
        "deadline": {
            "type": "string",
            "description": (
                "Дедлайн закрытия вакансии в формате YYYY-MM-DD. Если в тексте "
                "указан срок проекта (например, '6 месяцев', 'до конца года') — "
                "посчитай дату от сегодняшнего дня (передаётся в системном промпте)."
            ),
        },
        "stack": {
            "type": "string",
            "description": (
                "CSV-список технологий через запятую с пробелом, например "
                "'Java, Spring, Kafka, PostgreSQL'. Только реально упомянутые "
                "технологии. Сохраняй каноничные имена ('PostgreSQL', не 'postgres')."
            ),
        },
        "description": {
            "type": "string",
            "description": (
                "Описание проекта/задач. Без требований (они отдельным полем). "
                "Можно сохранять буллеты — каждый с новой строки, начиная с '— '."
            ),
        },
        "requirements": {
            "type": "string",
            "description": (
                "Требования к кандидату. Только то, что в тексте под заголовком "
                "'Требования' (или эквивалент). Буллеты с '— ' в начале строки."
            ),
        },
    },
    "additionalProperties": False,
}

_SYSTEM_PROMPT = """\
Ты — помощник CRM рекрутингового агентства. Твоя задача — разбирать сплошной \
текст брифа вакансии (как его прислал клиент) и раскладывать по структурированным \
полям формы.

Правила:
1. Возвращай ТОЛЬКО ту информацию, которая явно следует из текста. Если поле \
не упомянуто — НЕ включай его в ответ. Не выдумывай.
2. Сохраняй язык оригинала (обычно русский). Не переводи названия технологий.
3. Если текст вообще не похож на бриф вакансии — верни пустой объект.
4. Не дублируй информацию между description и requirements.
5. Все даты — в формате YYYY-MM-DD.
6. Сегодняшняя дата: {today}. Если в тексте указан срок проекта \
('6 месяцев', '3 месяца', 'квартал') — посчитай deadline относительно неё.
"""

def _coerce_parsed(raw: dict[str, Any]) -> dict[str, Any]:
    """Финальная нормализация: отбрасываем чужие ключи, чистим пустые строки.

    LLM иногда возвращает значение 'null' строкой или пустую строку вместо
    отсутствия ключа — отфильтровываем такие, чтобы фронт получил минимальный
    объект без шума.
    """
    allowed = set(PARSED_VACANCY_SCHEMA["properties"].keys())
    out: dict[str, Any] = {}
    for key, value in raw.items():
        if key not in allowed:
            continue
        if value is None:
            continue
        if isinstance(value, str):
            v = value.strip()
            if not v or v.lower() in {"null", "none", "n/a", "не указано"}:
                continue
            out[key] = v
        elif isinstance(value, (int, float)):
            # rateClient может прийти как int — приводим к float положительному.
            if key == "rateClient":
                num = float(value)
                if num <= 0:
                    continue
                out[key] = num
            else:
                out[key] = value
        else:
            out[key] = value
    return out


async def parse_vacancy_text(text: str, *, today: str) -> dict[str, Any]:
    """Распарсить сплошной текст брифа вакансии.

    Возвращает dict с camelCase-ключами, готовый к сериализации в ParsedVacancy.
    Бросает `AiUnavailableError` / `AiBadRequestError` — обрабатывается на уровне
    эндпоинта в `app/api/v1/endpoints/vacancies.py`.
    """
    settings = get_settings()
    max_chars = settings.yandex_ai_max_input_chars
    snippet = text if len(text) <= max_chars else text[:max_chars]

    client = YandexGptClient()
    raw = await client.json_completion(
        system=_SYSTEM_PROMPT.format(today=today),
        user=snippet,
        schema_name="parsed_vacancy",
        schema=PARSED_VACANCY_SCHEMA,
    )
    return _coerce_parsed(raw)


__all__ = [
    "AiBadRequestError",
    "AiUnavailableError",
    "parse_vacancy_text",
    "PARSED_VACANCY_SCHEMA",
]
