"""work_sessions: активное время (Этап 3)

Revision ID: 0030_work_sessions_active_time
Revises: 0029_work_sessions
Create Date: 2026-06-03

Добавляем учёт «активного» времени поверх online-времени: вкладка видима И
было взаимодействие пользователя. `active_seconds` — накопленная сумма реально
активных интервалов внутри сессии, `last_active_at` — момент последнего сигнала
активности (для вычисления инкремента, см. worklog_service.record_activity).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_work_sessions_active_time"
down_revision: str | Sequence[str] | None = "0029_work_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "work_sessions",
        sa.Column(
            "active_seconds",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "work_sessions",
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("work_sessions", "last_active_at")
    op.drop_column("work_sessions", "active_seconds")
