"""telegram notification fields on users

Revision ID: 0027_telegram_fields
Revises: 0026_notification_comment
Create Date: 2026-05-31

Поля для рассылки уведомлений через Telegram-бота:
  * `telegram_chat_id` (BIGINT) — id переписки пользователя с ботом, ставится
    при привязке через /start;
  * `telegram_notifications_enabled` (BOOL, default true) — тумблер доставки
    в профиле.
Существующее поле `telegram` (@username, контакт) не трогаем.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_telegram_fields"
down_revision: str | Sequence[str] | None = "0026_notification_comment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "telegram_notifications_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "telegram_notifications_enabled")
    op.drop_column("users", "telegram_chat_id")
