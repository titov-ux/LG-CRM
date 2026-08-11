"""Screening: last_seen_at сессии + индекс сегментов по времени

Revision ID: 0035_screening_last_seen
Revises: 0034_screening
Create Date: 2026-08-11

`last_seen_at` — отметка живого WS: по ней уборщик (`screening.close_stale_sessions`)
отличает «рекрутер закрыл вкладку» от «идёт встреча» и не оставляет сессии
навсегда в статусе live. Индекс (session_id, started_ms) нужен дедупу эха —
он ищет пересекающиеся по времени сегменты соседнего канала.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0035_screening_last_seen"
down_revision: str | Sequence[str] | None = "0034_screening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "screening_sessions",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Живых сессий на момент миграции быть не должно, но если есть — считаем
    # их «видели только что», чтобы уборщик не закрыл их сразу после деплоя.
    op.execute(
        "UPDATE screening_sessions SET last_seen_at = now() WHERE status = 'live'"
    )
    op.create_index(
        "ix_screening_segments_session_started",
        "screening_segments",
        ["session_id", "started_ms"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_screening_segments_session_started", table_name="screening_segments"
    )
    op.drop_column("screening_sessions", "last_seen_at")
