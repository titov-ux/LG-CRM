"""candidates

Revision ID: 0005_candidates
Revises: 0004_vacancies
Create Date: 2026-05-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_candidates"
down_revision: str | Sequence[str] | None = "0004_vacancies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CANDIDATE_STATUSES = (
    "new",
    "recruiter_iv",
    "ready",
    "presented",
    "waiting_os",
    "offer",
    "rejected_client",
    "rejected_candidate",
    "hired",
    "reserve",
)
EMPLOYMENT_TYPES = ("ИП", "СМЗ", "ТК РФ")


def upgrade() -> None:
    postgresql.ENUM(*CANDIDATE_STATUSES, name="candidate_status", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*EMPLOYMENT_TYPES, name="employment_type", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "candidates",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=255), nullable=False, server_default=""),
        sa.Column(
            "engagement_type",
            postgresql.ENUM(name="engagement_type", create_type=False),
            nullable=False,
            server_default="outstaff",
        ),
        sa.Column(
            "grade",
            postgresql.ENUM(name="grade", create_type=False),
            nullable=False,
            server_default="Middle",
        ),
        sa.Column("experience_years", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column(
            "stack",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("rate_month", sa.Numeric(12, 2), nullable=True),
        sa.Column(
            "employment_type",
            postgresql.ENUM(*EMPLOYMENT_TYPES, name="employment_type", create_type=False),
            nullable=False,
            server_default="СМЗ",
        ),
        sa.Column(
            "format",
            postgresql.ENUM(name="work_format", create_type=False),
            nullable=False,
            server_default="Гибрид",
        ),
        sa.Column("location", sa.String(length=255), nullable=False, server_default=""),
        sa.Column(
            "recruiter_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(*CANDIDATE_STATUSES, name="candidate_status", create_type=False),
            nullable=False,
            server_default="new",
        ),
        sa.Column(
            "status_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("telegram", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("email", postgresql.CITEXT(), nullable=True, unique=True),
        sa.Column("birthday", sa.Date(), nullable=True),
        sa.Column("kanban_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "archived_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("archive_reason", sa.String(length=1024), nullable=True),
        sa.Column(
            "resume",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
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
    op.create_index("ix_candidates_email", "candidates", ["email"])
    op.create_index("ix_candidates_recruiter_id", "candidates", ["recruiter_id"])
    op.create_index("ix_candidates_status", "candidates", ["status"])
    op.create_index("ix_candidates_archived", "candidates", ["archived"])
    op.create_index("ix_candidates_deleted_at", "candidates", ["deleted_at"])
    op.execute("CREATE INDEX ix_candidates_stack_gin ON candidates USING gin (stack)")
    op.execute(
        "CREATE INDEX ix_candidates_fullname_trgm ON candidates USING gin (full_name gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_candidates_fullname_trgm")
    op.execute("DROP INDEX IF EXISTS ix_candidates_stack_gin")
    op.drop_index("ix_candidates_deleted_at", table_name="candidates")
    op.drop_index("ix_candidates_archived", table_name="candidates")
    op.drop_index("ix_candidates_status", table_name="candidates")
    op.drop_index("ix_candidates_recruiter_id", table_name="candidates")
    op.drop_index("ix_candidates_email", table_name="candidates")
    op.drop_table("candidates")
    op.execute("DROP TYPE IF EXISTS employment_type")
    op.execute("DROP TYPE IF EXISTS candidate_status")
