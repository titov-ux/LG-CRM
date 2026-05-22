"""notifications

Revision ID: 0009_notifications
Revises: 0008_files
Create Date: 2026-05-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_notifications"
down_revision: str | Sequence[str] | None = "0008_files"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


NOTIFICATION_KINDS = ("mention", "status_change", "system")
NOTIFICATION_ENTITY_TYPES = ("vacancy", "candidate", "client", "contact")


def upgrade() -> None:
    postgresql.ENUM(*NOTIFICATION_KINDS, name="notification_kind", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(
        *NOTIFICATION_ENTITY_TYPES, name="notification_entity_type", create_type=True
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "notifications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "kind",
            postgresql.ENUM(*NOTIFICATION_KINDS, name="notification_kind", create_type=False),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "entity_type",
            postgresql.ENUM(
                *NOTIFICATION_ENTITY_TYPES,
                name="notification_entity_type",
                create_type=False,
            ),
            nullable=True,
        ),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
    op.execute("DROP TYPE IF EXISTS notification_entity_type")
    op.execute("DROP TYPE IF EXISTS notification_kind")
