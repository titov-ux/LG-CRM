"""vacancy_candidates (matching)

Revision ID: 0006_vacancy_candidates
Revises: 0005_candidates
Create Date: 2026-05-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_vacancy_candidates"
down_revision: str | Sequence[str] | None = "0005_candidates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


MATCH_STATUSES = (
    "submitted",
    "reviewed",
    "interview",
    "offered",
    "accepted",
    "rejected_client",
    "rejected_internal",
)


def upgrade() -> None:
    postgresql.ENUM(*MATCH_STATUSES, name="match_status", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "vacancy_candidates",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "vacancy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vacancies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "candidate_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(*MATCH_STATUSES, name="match_status", create_type=False),
            nullable=False,
            server_default="submitted",
        ),
        sa.Column(
            "added_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("feedback", sa.Text(), nullable=True),
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
        sa.UniqueConstraint("vacancy_id", "candidate_id", name="uq_vacancy_candidate"),
    )
    op.create_index("ix_vacancy_candidates_vacancy_id", "vacancy_candidates", ["vacancy_id"])
    op.create_index("ix_vacancy_candidates_candidate_id", "vacancy_candidates", ["candidate_id"])


def downgrade() -> None:
    op.drop_index("ix_vacancy_candidates_candidate_id", table_name="vacancy_candidates")
    op.drop_index("ix_vacancy_candidates_vacancy_id", table_name="vacancy_candidates")
    op.drop_table("vacancy_candidates")
    op.execute("DROP TYPE IF EXISTS match_status")
