"""Unit-тесты AI-скоринга кандидат↔вакансия (без БД и сети).

Покрывают детерминированную часть (cheap_score, веса, пороги, хэш) и слияние
оценки LLM поверх cheap-базы через монки-патч YandexGptClient.json_completion.
"""
from __future__ import annotations

import pytest

from app.modules.matching import ai


def _cand(**over):
    base = {
        "fullName": "Иван Петров",
        "role": "Backend",
        "grade": "Senior",
        "experienceYears": 6,
        "format": "Гибрид",
        "engagementType": "outstaff",
        "rateMonth": 250000,
        "stack": ["Java", "Spring", "PostgreSQL"],
    }
    base.update(over)
    return base


def _vac(**over):
    base = {
        "title": "Senior Backend (Java)",
        "grade": "Senior",
        "format": "Гибрид",
        "engagementType": "outstaff",
        "rateClient": 3000,
        "stack": ["Java", "Spring", "Kafka", "PostgreSQL"],
    }
    base.update(over)
    return base


# === Пороги категории ========================================================
@pytest.mark.parametrize(
    "score,expected",
    [(100, "strong"), (75, "strong"), (74, "good"), (50, "good"), (49, "weak"), (25, "weak"), (24, "mismatch"), (0, "mismatch")],
)
def test_recommendation_thresholds(score, expected):
    assert ai.recommendation_from_score(score) == expected


# === Стек ====================================================================
def test_stack_overlap():
    bd = ai.cheap_score(_cand(), _vac())
    # 3 из 4 требуемых (нет Kafka) → 75.
    assert bd["stack"]["score"] == 75
    assert "Kafka" in bd["stack"]["note"]


def test_stack_dropped_when_vacancy_has_none():
    bd = ai.cheap_score(_cand(), _vac(stack=[]))
    assert "stack" not in bd


# === Грейд ===================================================================
def test_grade_exact_and_below():
    assert ai.cheap_score(_cand(grade="Senior"), _vac(grade="Senior"))["grade"]["score"] == 100
    assert ai.cheap_score(_cand(grade="Middle"), _vac(grade="Senior"))["grade"]["score"] == 60
    assert ai.cheap_score(_cand(grade="Junior"), _vac(grade="Senior"))["grade"]["score"] == 30
    # Кандидат выше требуемого — тоже 100.
    assert ai.cheap_score(_cand(grade="Lead"), _vac(grade="Middle"))["grade"]["score"] == 100


# === Формат ==================================================================
def test_format_matrix():
    assert ai.cheap_score(_cand(format="Гибрид"), _vac(format="Гибрид"))["format"]["score"] == 100
    assert ai.cheap_score(_cand(format="Удалённо"), _vac(format="Гибрид"))["format"]["score"] == 75
    assert ai.cheap_score(_cand(format="Удалённо"), _vac(format="Офис"))["format"]["score"] == 40


# === Релевантность и ставка =================================================
def test_rate_never_scored():
    # Ставку калькулятор закрывает — в скоринге её быть не должно.
    assert "rate" not in ai.cheap_score(_cand(), _vac())
    assert "rate" not in ai.WEIGHTS


def test_relevance_is_llm_only():
    # relevance детерминированно не считается (нет в cheap_score), но есть в весах.
    assert "relevance" not in ai.cheap_score(_cand(), _vac())
    assert "relevance" in ai.WEIGHTS


# === Взвешенный итог =========================================================
def test_weighted_total_renormalizes():
    # Только два критерия с равными весами 0.2 и score 100/0 → 50.
    bd = {
        "grade": {"score": 100, "weight": 0.2, "note": ""},
        "experience": {"score": 0, "weight": 0.2, "note": ""},
    }
    assert ai.weighted_total(bd) == 50


def test_weighted_total_empty_is_zero():
    assert ai.weighted_total({}) == 0


def test_cheap_result_shape():
    res = ai.cheap_result(_cand(), _vac())
    assert set(res) == {
        "score", "recommendation", "breakdown", "summary",
        "strengths", "gaps", "model", "input_hash",
    }
    assert res["model"] == "cheap"
    assert res["summary"] is None
    assert 0 <= res["score"] <= 100
    assert res["recommendation"] == ai.recommendation_from_score(res["score"])


# === Хэш входа ===============================================================
def test_input_hash_stable_and_sensitive():
    h1 = ai.compute_input_hash(_cand(), _vac())
    h2 = ai.compute_input_hash(_cand(), _vac())
    assert h1 == h2
    h3 = ai.compute_input_hash(_cand(stack=["Java"]), _vac())
    assert h1 != h3


# === Слияние LLM поверх cheap ===============================================
async def test_score_match_merges_llm(monkeypatch):
    async def fake_json_completion(self, **kwargs):
        return {
            "stack": {"score": 90, "note": "почти весь стек"},
            "relevance": {"score": 70, "note": "похожий домен"},
            "grade": {"score": 100, "note": "совпадает"},
            "strengths": ["Сильный Java"],
            "gaps": ["Нет Kafka"],
            "summary": "Хороший матч.",
        }

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    # is_configured должен пускать — подменим property на True.
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )

    res = await ai.score_match(_cand(), _vac())
    # Веса наши, score стека взят у LLM (90, а не 75 из cheap).
    assert res["breakdown"]["stack"]["score"] == 90
    # relevance детерминированно не считается — добавлен из ответа LLM со своим весом.
    assert res["breakdown"]["relevance"]["score"] == 70
    assert res["breakdown"]["relevance"]["weight"] == ai.WEIGHTS["relevance"]
    assert res["summary"] == "Хороший матч."
    assert res["strengths"] == ["Сильный Java"]
    assert res["gaps"] == ["Нет Kafka"]
    assert res["model"] != "cheap"


async def test_score_match_falls_back_to_cheap_on_unavailable(monkeypatch):
    async def boom(self, **kwargs):
        raise ai.AiUnavailableError("no key")

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion", boom
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )
    # score_match пробрасывает AiUnavailableError — graceful-фоллбэк делает
    # вызывающий код; проверяем, что исключение действительно прокидывается.
    with pytest.raises(ai.AiUnavailableError):
        await ai.score_match(_cand(), _vac())


# === Метрики =================================================================
def test_metrics_counters():
    from app.modules.matching import metrics as m

    m.SCORING_METRICS.reset()
    m.record_cache_hit()
    m.record_llm(120.0)
    m.record_llm(80.0)
    m.record_cheap_fallback(5.0)
    m.record_error()
    snap = m.SCORING_METRICS.snapshot()
    assert snap["cache_hits"] == 1
    assert snap["llm_calls"] == 2
    assert snap["cheap_fallbacks"] == 1
    assert snap["errors"] == 1
    assert snap["llm_avg_latency_ms"] == 100.0
    m.SCORING_METRICS.reset()
    assert m.SCORING_METRICS.snapshot()["llm_calls"] == 0
