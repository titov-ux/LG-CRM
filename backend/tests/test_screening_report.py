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
    assert "почти пуст" in out["summary"]


async def test_generate_report_calls_llm(monkeypatch):
    async def fake_json_completion(self, **kwargs):
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

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.model",
        "yandexgpt/rc",
        raising=False,
    )

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
        candidate_payload={"fullName": "Иван", "role": "Backend"},
        vacancy_payload={"title": "Java Dev"},
        questions=[{"text": "Kafka?", "status": "answered", "answer_summary": "да"}],
        segments=[
            {"speaker": "recruiter", "text": "Расскажите про Kafka"},
            {"speaker": "candidate", "text": "Писал продюсеры три года"},
        ],
    )
    assert out["verdict"] == ScreeningVerdict.partial_fit
    assert out["red_flags"] == ["Нет опыта Kafka"]
    assert out["prompt_version"] == report.PROMPT_VERSION
    assert out["model"] == "yandexgpt/rc"
