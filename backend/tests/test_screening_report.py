"""Unit-тесты пост-анализа отчёта скрининга (Этап 5)."""
from __future__ import annotations

import pytest

from app.modules.screening import report
from app.modules.screening.models import ScreeningVerdict


def test_coerce_report_normalizes():
    raw = {
        "summary": "  Кандидат уверенно рассказал про Kafka. ",
        "verdict": "fit",
        "scores": {
            "communication": {"score": 5, "note": "ясно"},
            "motivation": {"score": 4, "note": "ок"},
            # hard_skills missing → default 3
            "experience_fit": {"score": 9, "note": "clamp"},  # → 5
            "culture_fit": {"score": 0, "note": "clamp"},  # → 1
        },
        "red_flags": ["  Частая смена работы  ", "", None, "Частая смена работы"],
        "recommendation": "На техсобес.",
    }
    out = report.coerce_report(raw)
    assert out["summary"].startswith("Кандидат")
    assert out["verdict"] == ScreeningVerdict.fit
    assert out["scores"]["communication"]["score"] == 5
    assert out["scores"]["hard_skills"]["score"] == 3
    assert out["scores"]["experience_fit"]["score"] == 5
    assert out["scores"]["culture_fit"]["score"] == 1
    assert out["red_flags"] == ["Частая смена работы"]
    assert out["recommendation"] == "На техсобес."


def test_fallback_empty_transcript():
    out = report.fallback_report(
        transcript_chars=0, answered_questions=0, total_questions=5
    )
    assert out["model"] == "fallback"
    assert out["verdict"] == ScreeningVerdict.partial_fit
    assert "почти нет" in out["summary"]


class _StubClient:
    """Заглушка YandexGptClient: запоминает промпт, отдаёт валидный JSON."""

    model = "yandexgpt/rc"
    last_user: str = ""

    def __init__(self, *a, **k):
        pass

    async def json_completion(self, **kwargs):
        type(self).last_user = kwargs["user"]
        return {
            "summary": "Ок.",
            "verdict": "partial_fit",
            "scores": {k: {"score": 3, "note": "ok"} for k in report.SCORE_KEYS},
            "red_flags": [],
            "recommendation": "Следующий шаг.",
        }


async def test_generate_report_caps_checklist(monkeypatch):
    """Чек-лист тоже режется: раньше под max_chars попадал только транскрипт.

    Агент за встречу добавляет follow-up, а рекрутер может вставить в вопрос
    целое резюме — без потолка промпт улетал за контекст модели.
    """
    monkeypatch.setattr(
        "app.modules.screening.report.YandexGptClient", _StubClient
    )
    from app.core.config import get_settings

    max_chars = get_settings().yandex_ai_max_input_chars
    questions = [
        {
            "text": "В" * 5000,
            "status": "answered",
            "answer_summary": "О" * 5000,
            "goal": "цель",
        }
        for _ in range(200)
    ]
    await report.generate_screening_report(
        questions=questions,
        segments=[{"speaker": "candidate", "text": "Т" * 100_000}],
    )
    user = _StubClient.last_user
    # Промпт укладывается в бюджет входа (с небольшим запасом на заголовки).
    assert len(user) < max_chars + 500
    assert "опущено" in user or "[обрезано]" in user
    assert "=== ТРАНСКРИПТ ===" in user


async def test_generate_report_calls_llm(monkeypatch):
    captured: dict = {}

    async def fake_json_completion(self, **kwargs):
        captured["user"] = kwargs["user"]
        assert kwargs["schema_name"] == "screening_report"
        return {
            "summary": "Хороший скрининг.",
            "verdict": "partial_fit",
            "scores": {
                k: {"score": 4, "note": "ok"} for k in report.SCORE_KEYS
            },
            "red_flags": ["Нет опыта Kafka"],
            "recommendation": "Уточнить стек на техсобесе.",
        }

    # YandexGptClient stores model on instance from settings — set via init.
    class _Client:
        model = "yandexgpt/rc"

        def __init__(self, *a, **k):
            pass

        async def json_completion(self, **kwargs):
            return await fake_json_completion(self, **kwargs)

    monkeypatch.setattr(
        "app.modules.screening.report.YandexGptClient",
        _Client,
    )

    out = await report.generate_screening_report(
        questions=[
            {
                "text": "Kafka?",
                "status": "answered",
                "answer_summary": "да, 3 года",
                "goal": "стек",
            }
        ],
        segments=[
            {"speaker": "recruiter", "text": "Расскажите про Kafka"},
            {"speaker": "candidate", "text": "Писал продюсеры три года"},
        ],
    )
    user = captured["user"]
    assert "=== ЧЕК-ЛИСТ ВОПРОСОВ И ОТВЕТОВ ===" in user
    assert "=== ТРАНСКРИПТ ===" in user
    assert "=== ВАКАНСИЯ ===" not in user
    assert "=== КАНДИДАТ ===" not in user
    assert "Сопроводительное" not in user
    assert out["verdict"] == ScreeningVerdict.partial_fit
    assert out["red_flags"] == ["Нет опыта Kafka"]
    assert out["prompt_version"] == report.PROMPT_VERSION
    assert out["model"] == "yandexgpt/rc"
