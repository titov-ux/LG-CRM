"""SQLAlchemy-модель кандидатов.

Контракт — фронтовый `Candidate` (см. `frontend/src/api/types.ts`).
Резюме-поля (skillCategories, experience, education, certifications, languages)
хранятся в одной JSONB-колонке `resume` — это гибко и согласуется с тем, как
поля сегодня формируются на фронте (один объект, его удобно отдавать целиком).

Email — CITEXT UNIQUE: дубли по email невозможны на уровне БД.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampsMixin
from app.modules.vacancies.models import EngagementType, Grade, WorkFormat


class CandidateStatus(str, enum.Enum):
    new = "new"
    recruiter_iv = "recruiter_iv"
    ready = "ready"
    presented = "presented"
    waiting_os = "waiting_os"
    offer = "offer"
    rejected_client = "rejected_client"
    rejected_candidate = "rejected_candidate"
    hired = "hired"
    reserve = "reserve"


class EmploymentType(str, enum.Enum):
    ip = "ИП"
    smz = "СМЗ"
    tk_rf = "ТК РФ"


def _enum_values(e):
    return [m.value for m in e]


class Candidate(Base, TimestampsMixin, SoftDeleteMixin):
    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    engagement_type: Mapped[EngagementType] = mapped_column(
        Enum(EngagementType, name="engagement_type", values_callable=_enum_values, create_type=False),
        nullable=False,
        default=EngagementType.outstaff,
    )
    grade: Mapped[Grade] = mapped_column(
        Enum(Grade, name="grade", values_callable=_enum_values, create_type=False),
        nullable=False,
        default=Grade.middle,
    )
    experience_years: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    stack: Mapped[list[str]] = mapped_column(
        ARRAY(Text()),
        nullable=False,
        server_default=text("'{}'::text[]"),
    )
    rate_month: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    employment_type: Mapped[EmploymentType] = mapped_column(
        Enum(EmploymentType, name="employment_type", values_callable=_enum_values),
        nullable=False,
        default=EmploymentType.smz,
    )
    format_: Mapped[WorkFormat] = mapped_column(
        "format",
        Enum(WorkFormat, name="work_format", values_callable=_enum_values, create_type=False),
        nullable=False,
        default=WorkFormat.hybrid,
    )
    location: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # nullable=True + SET NULL: при удалении пользователя ответственный сбрасывается
    # в пустое значение, кандидат не удаляется. См. миграцию 0011_user_fk_set_null.
    recruiter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[CandidateStatus] = mapped_column(
        Enum(CandidateStatus, name="candidate_status", values_callable=_enum_values),
        nullable=False,
        default=CandidateStatus.new,
        index=True,
    )
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    telegram: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    email: Mapped[str | None] = mapped_column(CITEXT(), nullable=True, unique=True, index=True)
    birthday: Mapped[date | None] = mapped_column(Date(), nullable=True)
    kanban_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[str | None] = mapped_column(Text(), nullable=True)

    # Архив (убрано с канбана, но в базе остаётся).
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archive_reason: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # Резюме одной JSONB-колонкой: skillCategories, experience, education, certifications, languages.
    resume: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
