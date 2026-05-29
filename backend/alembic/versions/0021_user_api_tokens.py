"""user_api_tokens — личные API-токены для Chrome-расширения hh.ru

Revision ID: 0021_user_api_tokens
Revises: 0020_integration_tokens
Create Date: 2026-05-30

Зачем: рекрутер хочет сохранять резюме одной кнопкой прямо на странице hh.ru,
не переключаясь в CRM. Браузерное расширение шлёт запрос с заголовком
`Authorization: Bearer <raw_token>`. JWT для этого не подходит — он
короткоживущий и привязан к refresh-cookie в браузере CRM.

Храним:
* `token_hash` — sha256 от raw-токена. Сам токен пользователь видит один раз
  при выпуске; восстановить из БД нельзя.
* `prefix` — первые 8 символов raw-токена (для UI: «lg_abc12345…»).
* `last_used_at` — обновляется при каждом успешном использовании. Без
  индекса — пишется чаще, чем читается; для админ-отчётов хватит seq scan.
* `revoked_at` — soft-revoke: токен в БД остаётся (для аудита), но не
  принимается auth-dependency.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0021_user_api_tokens"
down_revision: str | Sequence[str] | None = "0020_integration_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_api_tokens",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        # UNIQUE-индекс на hash — токены не должны коллизировать; sha256 хватает.
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("prefix", sa.String(16), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("user_api_tokens")
