"""Unit-тесты генерации вопросов скрининга (без сети)."""
from __future__ import annotations

import pytest

from app.modules.screening import ai


def _cand(**over):
    base = {
        "fullName": "Иван Петров",
        "role": "Backend",
        "grade": "Senior",
        "experienceYears": 6,
        "format": "Гибрид",
        "stack": ["Java", "Spring", "PostgreSQL"],
        "summary": "Пишу сервисы на Java 5 лет",
    }
    base.update(over)
    return base


def _vac(**over):
    base = {
        "title": "Senior Backend (Java)",
        "grade": "Senior",
        "format": "Гибрид",
        "stack": ["Java", "Spring", "Kafka"],
        "requirements": "Опыт с Kafka обязателен",
    }
    base.update(over)
    return base


async def test_generate_questions_coerces(monkeypatch):
    async def fake_json_completion(self, **kwargs):
        return {
            "questions": [
                {"text": " Расскажите про Kafka ", "goal": "Стек"},
                {"text": "Расскажите про Kafka", "goal": "дубль"},  # drop
                {"text": "", "goal": "x"},  # drop
                {"text": "Почему ищете работу?", "goal": None},
                {"text": "Какой формат удобен?", "goal": "Условия"},
                {"text": "Опишите последний проект", "goal": "Опыт"},
                {"text": "Как оцениваете Senior-уровень?", "goal": "Грейд"},
            ]
        }

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )

    qs = await ai.generate_screening_questions(
        candidate_payload=_cand(), vacancy_payload=_vac()
    )
    assert len(qs) == 5
    assert qs[0]["text"] == "Расскажите про Kafka"
    assert qs[0]["goal"] == "Стек"
    assert qs[1]["goal"] == "Уточнить опыт кандидата"  # None → дефолт


async def test_generate_too_few_raises(monkeypatch):
    async def fake_json_completion(self, **kwargs):
        return {"questions": [{"text": "Только один", "goal": "g"}]}

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )

    with pytest.raises(ai.AiUnavailableError):
        await ai.generate_screening_questions(candidate_payload=_cand())
