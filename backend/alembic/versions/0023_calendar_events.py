"""calendar events (interviews)

Revision ID: 0023_calendar_events
Revises: 0022_integration_tokens_per_user
Create Date: 2026-05-30
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_calendar_events"
down_revision: str | Sequence[str] | None = "0022_integration_tokens_per_user"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVENT_TYPES = ("interview", "meeting", "reminder")
EVENT_LOCATIONS = ("online", "onsite", "phone")
EVENT_STATUSES = ("scheduled", "held", "no_show", "canceled")
ATTENDEE_RESPONSES = ("invited", "accepted", "declined")


def upgrade() -> None:
    # Расширяем enum уведомлений новым значением (PG 12+ допускает ADD VALUE в
    # транзакции, т.к. в этой же миграции значение не используется).
    op.execute("ALTER TYPE notification_entity_type ADD VALUE IF NOT EXISTS 'event'")

    postgresql.ENUM(*EVENT_TYPES, name="event_type", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*EVENT_LOCATIONS, name="event_location", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*EVENT_STATUSES, name="event_status", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(
        *ATTENDEE_RESPONSES, name="attendee_response", create_type=True
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "calendar_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "type",
            postgresql.ENUM(*EVENT_TYPES, name="event_type", create_type=False),
            nullable=False,
            server_default="interview",
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "location_kind",
            postgresql.ENUM(*EVENT_LOCATIONS, name="event_location", create_type=False),
            nullable=False,
            server_default="online",
        ),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(*EVENT_STATUSES, name="event_status", create_type=False),
            nullable=False,
            server_default="scheduled",
        ),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column(
            "candidate_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("candidates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "vacancy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vacancies.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "match_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vacancy_candidates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_calendar_events_starts_at", "calendar_events", ["starts_at"])
    op.create_index("ix_calendar_events_status", "calendar_events", ["status"])
    op.create_index("ix_calendar_events_candidate_id", "calendar_events", ["candidate_id"])
    op.create_index("ix_calendar_events_vacancy_id", "calendar_events", ["vacancy_id"])
    op.create_index("ix_calendar_events_match_id", "calendar_events", ["match_id"])

    op.create_table(
        "calendar_event_attendees",
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("calendar_events.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "response",
            postgresql.ENUM(*ATTENDEE_RESPONSES, name="attendee_response", create_type=False),
            nullable=False,
            server_default="invited",
        ),
        sa.UniqueConstraint("event_id", "user_id", name="uq_calendar_attendee"),
    )
    op.create_index(
        "ix_calendar_event_attendees_user_id", "calendar_event_attendees", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_event_attendees_user_id", table_name="calendar_event_attendees")
    op.drop_table("calendar_event_attendees")

    op.drop_index("ix_calendar_events_match_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_vacancy_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_candidate_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_status", table_name="calendar_events")
    op.drop_index("ix_calendar_events_starts_at", table_name="calendar_events")
    op.drop_table("calendar_events")

    op.execute("DROP TYPE IF EXISTS attendee_response")
    op.execute("DROP TYPE IF EXISTS event_status")
    op.execute("DROP TYPE IF EXISTS event_location")
    op.execute("DROP TYPE IF EXISTS event_type")
