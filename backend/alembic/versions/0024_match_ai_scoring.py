"""match ai scoring

Revision ID: 0024_match_ai_scoring
Revises: 0023_calendar_events
Create Date: 2026-05-31
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0024_match_ai_scoring"
down_revision: str | Sequence[str] | None = "0023_calendar_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RECOMMENDATIONS = ("strong", "good", "weak", "mismatch")


def upgrade() -> None:
    postgresql.ENUM(
        *RECOMMENDATIONS, name="match_recommendation", create_type=True
    ).create(op.get_bind(), checkfirst=True)

    op.add_column(
        "vacancy_candidates",
        sa.Column("ai_score", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "vacancy_candidates",
        sa.Column(
            "ai_recommendation",
            postgresql.ENUM(
                *RECOMMENDATIONS, name="match_recommendation", create_type=False
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "vacancy_candidates",
        sa.Column("ai_breakdown", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "vacancy_candidates",
        sa.Column("ai_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "vacancy_candidates",
        sa.Column("ai_strengths", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "vacancy_candidates",
        sa.Column("ai_gaps", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "vacancy_candidates",
        sa.Column("ai_scored_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "vacancy_candidates",
        sa.Column("ai_model", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "vacancy_candidates",
        sa.Column("ai_input_hash", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("vacancy_candidates", "ai_input_hash")
    op.drop_column("vacancy_candidates", "ai_model")
    op.drop_column("vacancy_candidates", "ai_scored_at")
    op.drop_column("vacancy_candidates", "ai_gaps")
    op.drop_column("vacancy_candidates", "ai_strengths")
    op.drop_column("vacancy_candidates", "ai_summary")
    op.drop_column("vacancy_candidates", "ai_breakdown")
    op.drop_column("vacancy_candidates", "ai_recommendation")
    op.drop_column("vacancy_candidates", "ai_score")

    postgresql.ENUM(
        *RECOMMENDATIONS, name="match_recommendation", create_type=False
    ).drop(op.get_bind(), checkfirst=True)
