"""Модель связки кандидат ↔ вакансия (matching).

Это полноценная сущность с собственным статусом (отличается от статусов
candidate/vacancy) — поэтому отдельная таблица, а не M2M через ассоциацию.

UNIQUE(vacancy_id, candidate_id) — кандидат не может быть прикреплён к одной
вакансии дважды (нужно для идемпотентного POST).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampsMixin


class MatchStatus(str, enum.Enum):
    submitted = "submitted"
    reviewed = "reviewed"
    interview = "interview"
    offered = "offered"
    accepted = "accepted"
    rejected_client = "rejected_client"
    rejected_internal = "rejected_internal"


class MatchRecommendation(str, enum.Enum):
    """Категория AI-скоринга — выводится из числа порогами (см. matching/ai.py).

    strong ≥ 75 · good 50–74 · weak 25–49 · mismatch < 25.
    """

    strong = "strong"
    good = "good"
    weak = "weak"
    mismatch = "mismatch"


def _enum_values(e):
    return [m.value for m in e]


class VacancyCandidate(Base, TimestampsMixin):
    __tablename__ = "vacancy_candidates"
    __table_args__ = (
        UniqueConstraint("vacancy_id", "candidate_id", name="uq_vacancy_candidate"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    vacancy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vacancies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[MatchStatus] = mapped_column(
        Enum(MatchStatus, name="match_status", values_callable=_enum_values),
        nullable=False,
        default=MatchStatus.submitted,
    )
    added_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    feedback: Mapped[str | None] = mapped_column(Text(), nullable=True)

    # === AI-скоринг соответствия (см. modules/matching/ai.py) ===============
    # Все поля nullable: NULL = ещё не считали. Кэш дорогой LLM-оценки живёт
    # прямо в связке; повторный расчёт пропускается, если ai_input_hash совпал
    # с хэшем текущих данных кандидата+вакансии (поле stale на фронте).
    ai_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    ai_recommendation: Mapped[MatchRecommendation | None] = mapped_column(
        Enum(
            MatchRecommendation,
            name="match_recommendation",
            values_callable=_enum_values,
        ),
        nullable=True,
    )
    # {"stack": {"score": 80, "weight": 0.35, "note": "..."}, ...}
    ai_breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text(), nullable=True)
    ai_strengths: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    ai_gaps: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    ai_scored_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 'yandexgpt/rc' для LLM-оценки или 'cheap' для детерминированного фоллбэка.
    ai_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ai_input_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
