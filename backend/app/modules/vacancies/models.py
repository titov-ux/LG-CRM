"""SQLAlchemy-модели вакансий.

Контракт — фронтовый `Vacancy` (см. `frontend/src/api/types.ts`).
* `stack` — Postgres ARRAY(text), под GIN-индекс — для фильтра «вакансии со
  Stack-тегом X».
* `recruiterIds` — M2M через `vacancy_recruiters` (составной PK, CASCADE).
* `status_changed_at` обновляется триггером на смене status (или вручную в
  сервисе); `daysInStatus` считается на чтении.
* `kanban_order` — целое; вакансии в одной колонке сортируются по нему.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    ARRAY,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampsMixin


class EngagementType(str, enum.Enum):
    outstaff = "outstaff"
    agency = "agency"


class Grade(str, enum.Enum):
    junior = "Junior"
    middle = "Middle"
    senior = "Senior"
    lead = "Lead"


class WorkFormat(str, enum.Enum):
    remote = "Удалённо"
    hybrid = "Гибрид"
    office = "Офис"


class Priority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class VacancyStatus(str, enum.Enum):
    new = "new"
    in_work = "in_work"
    proposed = "proposed"
    interview = "interview"
    waiting_os = "waiting_os"
    closed_success = "closed_success"
    closed = "closed"
    paused = "paused"


def _enum_values(e):
    return [m.value for m in e]


class Vacancy(Base, TimestampsMixin, SoftDeleteMixin):
    __tablename__ = "vacancies"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    engagement_type: Mapped[EngagementType] = mapped_column(
        Enum(EngagementType, name="engagement_type", values_callable=_enum_values),
        nullable=False,
        default=EngagementType.outstaff,
    )
    project: Mapped[str | None] = mapped_column(String(255), nullable=True)
    grade: Mapped[Grade] = mapped_column(
        Enum(Grade, name="grade", values_callable=_enum_values),
        nullable=False,
        default=Grade.middle,
    )
    # Postgres ARRAY(text) — поверх него GIN-индекс для фильтра по stack.
    stack: Mapped[list[str]] = mapped_column(
        ARRAY(Text()),
        nullable=False,
        server_default=text("'{}'::text[]"),
    )
    format_: Mapped[WorkFormat] = mapped_column(
        "format",
        Enum(WorkFormat, name="work_format", values_callable=_enum_values),
        nullable=False,
        default=WorkFormat.hybrid,
    )
    rate_client: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    salary_max: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    positions: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[VacancyStatus] = mapped_column(
        Enum(VacancyStatus, name="vacancy_status", values_callable=_enum_values),
        nullable=False,
        default=VacancyStatus.new,
        index=True,
    )
    priority: Mapped[Priority] = mapped_column(
        Enum(Priority, name="priority", values_callable=_enum_values),
        nullable=False,
        default=Priority.medium,
    )
    # nullable=True + SET NULL: при удалении пользователя ответственный сбрасывается
    # в пустое значение, вакансия не удаляется. См. миграцию 0011_user_fk_set_null.
    account_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    deadline: Mapped[date | None] = mapped_column(Date(), nullable=True)
    kanban_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    requirements: Mapped[str | None] = mapped_column(Text(), nullable=True)

    # M2M через ассоциативную таблицу (см. ниже).
    recruiters: Mapped[list["VacancyRecruiter"]] = relationship(
        back_populates="vacancy",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class VacancyRecruiter(Base):
    """Связка вакансия ↔ рекрутер (M2M)."""

    __tablename__ = "vacancy_recruiters"
    __table_args__ = (UniqueConstraint("vacancy_id", "user_id", name="uq_vacancy_recruiter"),)

    vacancy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vacancies.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    vacancy: Mapped[Vacancy] = relationship(back_populates="recruiters")
