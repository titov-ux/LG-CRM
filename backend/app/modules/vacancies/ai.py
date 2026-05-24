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

import logging
import re
from datetime import date
from typing import Any

from app.core.config import get_settings
from app.integrations.yandex_gpt import (
    AiBadRequestError,
    AiUnavailableError,
    YandexGptClient,
)
from app.modules.vacancies.models import Grade, Priority, WorkFormat

logger = logging.getLogger(__name__)

# Регэксп для извлечения первой ISO-даты из произвольной строки.
# LLM иногда возвращает диапазон ('2026-09-01 — 2027-03-01') или дату с пояснением —
# мы берём первую YYYY-MM-DD и валидируем как реальную дату.
_ISO_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")

_GRADE_VALUES: set[str] = {g.value for g in Grade}
_FORMAT_VALUES: set[str] = {f.value for f in WorkFormat}
_PRIORITY_VALUES: set[str] = {p.value for p in Priority}

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
5. Поле `deadline` — ВСЕГДА одна дата в формате YYYY-MM-DD. \
НЕ возвращай диапазон ('2026-09-01 — 2027-03-01'), НЕ добавляй пояснений. \
Если в тексте указан срок проекта (например, '6 месяцев', '3 месяца') — \
посчитай deadline как (сегодня + срок) и верни ОДНУ дату — окончание проекта.
6. Сегодняшняя дата: {today}.
"""

def _clean_string(value: Any) -> str | None:
    """Привести значение к непустой строке или вернуть None."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v or v.lower() in {"null", "none", "n/a", "не указано", "не указан"}:
        return None
    return v


def _coerce_deadline(value: Any) -> str | None:
    """Извлечь ISO-дату из произвольной строки/числа.

    LLM иногда возвращает:
      • диапазон: '2026-11-24 — 2027-05-24' → берём первую дату
      • дату с пояснением: '2026-09-01 (примерно)' → берём дату
      • дату без zero-pad: '2026-9-1' → нормализуем
      • невалидную дату ('2026-13-50') → отбрасываем тихо
    """
    s = _clean_string(value)
    if not s:
        return None
    m = _ISO_DATE_RE.search(s)
    if not m:
        # Попытка YYYY-M-D (без zero-pad)
        m2 = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
        if not m2:
            return None
        y, mo, d = m2.group(1), m2.group(2).zfill(2), m2.group(3).zfill(2)
    else:
        y, mo, d = m.group(1), m.group(2), m.group(3)
    try:
        date(int(y), int(mo), int(d))  # валидация (31 февраля → ValueError)
    except ValueError:
        return None
    return f"{y}-{mo}-{d}"


def _coerce_enum(value: Any, allowed: set[str]) -> str | None:
    """Вернуть значение, если оно строкой и в списке допустимых, иначе None.

    LLM может вернуть 'senior' вместо 'Senior' — сначала пробуем как есть,
    потом case-insensitive поиск.
    """
    s = _clean_string(value)
    if s is None:
        return None
    if s in allowed:
        return s
    s_lower = s.lower()
    for v in allowed:
        if v.lower() == s_lower:
            return v
    return None


def _coerce_rate(value: Any) -> float | None:
    """Извлечь положительное число из числа/строки. None — если невалидно."""
    if isinstance(value, bool):  # bool — это int в Python, отдельно
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return num if num > 0 else None
    if isinstance(value, str):
        # Берём первое число в строке (на случай '3500 ₽/ч' или 'от 3000 до 5000').
        m = re.search(r"\d+(?:[.,]\d+)?", value.replace(" ", ""))
        if not m:
            return None
        try:
            num = float(m.group(0).replace(",", "."))
        except ValueError:
            return None
        return num if num > 0 else None
    return None


def _coerce_parsed(raw: dict[str, Any]) -> dict[str, Any]:
    """Нормализация ответа LLM в финальный ParsedVacancy-friendly dict.

    Каждое поле валидируем отдельно. Если значение не пригодно — ТИХО отбрасываем
    (с записью в лог на уровне debug). Это важно: лучше отдать частичный
    результат, чем 500 из-за невалидной даты или enum-значения.
    """
    out: dict[str, Any] = {}

    title = _clean_string(raw.get("title"))
    if title:
        out["title"] = title

    project = _clean_string(raw.get("project"))
    if project:
        out["project"] = project

    grade = _coerce_enum(raw.get("grade"), _GRADE_VALUES)
    if grade:
        out["grade"] = grade

    fmt = _coerce_enum(raw.get("format"), _FORMAT_VALUES)
    if fmt:
        out["format"] = fmt

    priority = _coerce_enum(raw.get("priority"), _PRIORITY_VALUES)
    if priority:
        out["priority"] = priority

    rate = _coerce_rate(raw.get("rateClient"))
    if rate is not None:
        out["rateClient"] = rate

    deadline = _coerce_deadline(raw.get("deadline"))
    if deadline:
        out["deadline"] = deadline
    elif raw.get("deadline"):
        logger.debug("vacancies.ai dropped invalid deadline: %r", raw.get("deadline"))

    stack = _clean_string(raw.get("stack"))
    if stack:
        out["stack"] = stack

    description = _clean_string(raw.get("description"))
    if description:
        out["description"] = description

    requirements = _clean_string(raw.get("requirements"))
    if requirements:
        out["requirements"] = requirements

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
