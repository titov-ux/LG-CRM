"""integration_tokens table for external OAuth providers (hh.ru first)

Revision ID: 0020_integration_tokens
Revises: 0019_perf_indexes
Create Date: 2026-05-30

Одна строка на провайдера (provider='hh'). access_token обновляется через
refresh_token автоматически; обе колонки нужны в БД, чтобы пережить рестарт
сервиса. Хранение в plaintext — приемлемо: токены долгоживущие, но регулярно
ротируются, а БД и так под VPC.

`scope` храним, чтобы понимать какие права у токена (необязательно сейчас).
`account_label` — что именно подключено (e-mail менеджера hh), для UI.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0020_integration_tokens"
down_revision: str | Sequence[str] | None = "0019_perf_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "integration_tokens",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("provider", sa.String(64), nullable=False, unique=True),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scope", sa.String(255), nullable=True),
        sa.Column("account_label", sa.String(255), nullable=True),
        sa.Column(
            "connected_by_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("integration_tokens")
