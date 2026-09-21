"""login_snapshots: снимки веб-камеры при входе

Revision ID: 0036_login_snapshots
Revises: 0035_screening_last_seen
Create Date: 2026-09-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0036_login_snapshots"
down_revision: str | Sequence[str] | None = "0035_screening_last_seen"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SNAPSHOT_STATUSES = ("ok", "denied", "no_camera", "error")


def upgrade() -> None:
    postgresql.ENUM(
        *SNAPSHOT_STATUSES, name="login_snapshot_status", create_type=True
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "login_snapshots",
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
        sa.Column(
            "status",
            postgresql.ENUM(
                *SNAPSHOT_STATUSES,
                name="login_snapshot_status",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("s3_key", sa.String(length=512), nullable=True),
        sa.Column("content_type", sa.String(length=64), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_login_snapshots_user_id", "login_snapshots", ["user_id"]
    )
    op.create_index(
        "ix_login_snapshots_created_at", "login_snapshots", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_login_snapshots_created_at", table_name="login_snapshots")
    op.drop_index("ix_login_snapshots_user_id", table_name="login_snapshots")
    op.drop_table("login_snapshots")
    postgresql.ENUM(name="login_snapshot_status").drop(op.get_bind(), checkfirst=True)
