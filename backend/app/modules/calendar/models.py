"""SQLAlchemy-модели календаря (события / собеседования).

Generic-таблица `calendar_events` с полем `type` — чтобы позже переиспользовать
под встречи/напоминания. В MVP наполняется только `interview`.

Ключевая связь — `match_id` → `vacancy_candidates`: назначение собеса двигает
канбан в стадию `interview`, а отметка исхода кормит `feedback` связки и
аналитику. FK на `users.id` — `SET NULL` + nullable (как миграция 0011), чтобы
удаление пользователя не блокировалось и не сносило события.

Коллизии слотов разрешены сознательно: у одного рекрутера может быть несколько
собеседований в одно время — никаких UNIQUE по (user, time) нет.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampsMixin


class EventType(str, enum.Enum):
    interview = "interview"
    meeting = "meeting"
    reminder = "reminder"


class EventLocationKind(str, enum.Enum):
    online = "online"
    onsite = "onsite"
    phone = "phone"


class EventStatus(str, enum.Enum):
    scheduled = "scheduled"
    held = "held"
    no_show = "no_show"
    canceled = "canceled"


class AttendeeResponse(str, enum.Enum):
    invited = "invited"
    accepted = "accepted"
    declined = "declined"


def _enum_values(e):
    return [m.value for m in e]


class CalendarEvent(Base, TimestampsMixin):
    __tablename__ = "calendar_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    type: Mapped[EventType] = mapped_column(
        Enum(EventType, name="event_type", values_callable=_enum_values),
        nullable=False,
        default=EventType.interview,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    location_kind: Mapped[EventLocationKind] = mapped_column(
        Enum(EventLocationKind, name="event_location", values_callable=_enum_values),
        nullable=False,
        default=EventLocationKind.online,
    )
    location: Mapped[str | None] = mapped_column(Text(), nullable=True)
    status: Mapped[EventStatus] = mapped_column(
        Enum(EventStatus, name="event_status", values_callable=_enum_values),
        nullable=False,
        default=EventStatus.scheduled,
        index=True,
    )
    outcome: Mapped[str | None] = mapped_column(Text(), nullable=True)

    candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("candidates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    vacancy_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vacancies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    match_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vacancy_candidates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Свипер напоминаний (см. lifespan) проставляет момент отправки, чтобы не
    # слать повторно. NULL = напоминание ещё не отправлялось.
    reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    attendees: Mapped[list["CalendarEventAttendee"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class CalendarEventAttendee(Base):
    """Участник события (внутренний пользователь CRM)."""

    __tablename__ = "calendar_event_attendees"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_calendar_attendee"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("calendar_events.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    response: Mapped[AttendeeResponse] = mapped_column(
        Enum(AttendeeResponse, name="attendee_response", values_callable=_enum_values),
        nullable=False,
        default=AttendeeResponse.invited,
    )

    event: Mapped[CalendarEvent] = relationship(back_populates="attendees")
