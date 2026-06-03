"""work_sessions: учёт времени сотрудников в системе

Revision ID: 0029_work_sessions
Revises: 0028_notification_chat_message
Create Date: 2026-06-03

Таблица интервалов «пользователь онлайн в CRM». Наполняется из тех же событий
жизненного цикла WS-соединения, что и presence (см. app/realtime/presence.py),
но, в отличие от presence, персистентна — отсюда строятся отчёты по времени.

FK на users.id — SET NULL + nullable (паттерн миграции 0011): удаление юзера
не блокируется и не сносит историю. Частичный unique-индекс гарантирует не
более одной открытой сессии (ended_at IS NULL) на пользователя.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0029_work_sessions"
down_revision: str | Sequence[str] | None = "0028_notification_chat_message"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

END_REASONS = ("disconnect", "sweep", "server_shutdown", "reconcile")


def upgrade() -> None:
    postgresql.ENUM(
        *END_REASONS, name="work_session_end_reason", create_type=True
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "work_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "end_reason",
            postgresql.ENUM(
                *END_REASONS, name="work_session_end_reason", create_type=False
            ),
            nullable=True,
        ),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_work_sessions_user_id", "work_sessions", ["user_id"])
    op.create_index("ix_work_sessions_started_at", "work_sessions", ["started_at"])
    op.create_index(
        "ix_work_sessions_user_started",
        "work_sessions",
        ["user_id", "started_at"],
    )
    # Не более одной открытой сессии на пользователя.
    op.create_index(
        "uq_work_sessions_open",
        "work_sessions",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_work_sessions_open", table_name="work_sessions")
    op.drop_index("ix_work_sessions_user_started", table_name="work_sessions")
    op.drop_index("ix_work_sessions_started_at", table_name="work_sessions")
    op.drop_index("ix_work_sessions_user_id", table_name="work_sessions")
    op.drop_table("work_sessions")
    postgresql.ENUM(name="work_session_end_reason").drop(
        op.get_bind(), checkfirst=True
    )
