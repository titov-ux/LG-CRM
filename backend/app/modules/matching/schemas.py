"""DTO модуля matching."""
from __future__ import annotations

import uuid
from datetime import datetime

from app.core.schemas import CamelModel
from app.modules.matching.models import MatchRecommendation, MatchStatus


class VacancyCandidateResponse(CamelModel):
    id: uuid.UUID
    vacancy_id: uuid.UUID
    candidate_id: uuid.UUID
    status: MatchStatus
    added_by_id: uuid.UUID | None = None
    added_at: datetime
    feedback: str | None = None

    # AI-скоринг (NULL, пока не считали). Чип на фронте рисуется прямо отсюда —
    # без отдельного запроса (см. plan-ai-scoring §6.3).
    ai_score: int | None = None
    ai_recommendation: MatchRecommendation | None = None
    ai_scored_at: datetime | None = None
    ai_model: str | None = None


class CriterionScore(CamelModel):
    score: int
    weight: float
    note: str = ""


class MatchScoreResponse(CamelModel):
    """Полный результат AI-скоринга связки (с разбивкой и вердиктом)."""

    # match_id = None для превью-скоринга (кандидат ещё не прикреплён).
    match_id: uuid.UUID | None = None
    vacancy_id: uuid.UUID
    candidate_id: uuid.UUID
    score: int
    recommendation: MatchRecommendation
    breakdown: dict[str, CriterionScore]
    summary: str | None = None
    strengths: list[str] = []
    gaps: list[str] = []
    model: str
    scored_at: datetime
    # Данные кандидата/вакансии изменились с момента расчёта → стоит пересчитать.
    stale: bool = False
    # false = LLM был недоступен, показан детерминированный фоллбэк (model='cheap').
    ai_enriched: bool = True


class AttachRequest(CamelModel):
    candidate_id: uuid.UUID


class UpdateMatchRequest(CamelModel):
    status: MatchStatus | None = None
    feedback: str | None = None


class ScoreCandidateRequest(CamelModel):
    """Превью-скор кандидата под вакансию без прикрепления и записи в БД."""

    candidate_id: uuid.UUID


class RankedCandidate(CamelModel):
    """Кандидат из базы, отранжированный под вакансию (подбор пула)."""

    candidate_id: uuid.UUID
    full_name: str
    role: str
    grade: str | None = None
    engagement_type: str | None = None
    status: str | None = None
    stack: list[str] = []
    score: int
    recommendation: MatchRecommendation
    breakdown: dict[str, CriterionScore]
    summary: str | None = None
    # true = верхний результат дообогащён LLM (релевантность + вердикт).
    ai_enriched: bool = False
