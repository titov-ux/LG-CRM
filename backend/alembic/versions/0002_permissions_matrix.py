"""permissions_matrix

Revision ID: 0002_permissions_matrix
Revises: 0001_users
Create Date: 2026-05-22

Этап 2 плана перехода на API: users + permissions.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_permissions_matrix"
down_revision: str | Sequence[str] | None = "0001_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "permissions_matrix",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("group", sa.String(length=64), nullable=False),
        sa.Column("permission", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1024), nullable=False, server_default=""),
        sa.Column(
            "actions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "matrix",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
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


def downgrade() -> None:
    op.drop_table("permissions_matrix")
