"""password_invites

Revision ID: 0010_password_invites
Revises: 0009_notifications
Create Date: 2026-05-26

Таблица одноразовых invite-токенов для активации новых пользователей. См.
`app/modules/users/invites.py` и поток в `auth/invite/*` эндпоинтах.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_password_invites"
down_revision: str | Sequence[str] | None = "0009_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "password_invites",
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
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_password_invites_user_id", "password_invites", ["user_id"])
    op.create_index("ix_password_invites_token_hash", "password_invites", ["token_hash"])


def downgrade() -> None:
    op.drop_index("ix_password_invites_token_hash", table_name="password_invites")
    op.drop_index("ix_password_invites_user_id", table_name="password_invites")
    op.drop_table("password_invites")
