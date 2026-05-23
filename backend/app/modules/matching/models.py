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

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
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
