"""notification kind: chat_message

Revision ID: 0028_notification_chat_message
Revises: 0027_telegram_fields
Create Date: 2026-06-02

Добавляем значение `chat_message` в enum `notification_kind` — уведомление
участникам диалога о новом сообщении в чате (см. chat/service.py:
_notify_new_message). Упоминания по-прежнему шлются отдельным kind=mention.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0028_notification_chat_message"
down_revision: str | Sequence[str] | None = "0027_telegram_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ALTER TYPE … ADD VALUE — postgres-специфично и должно идти вне транзакции,
    # поэтому используем autocommit_block (как в 0013/0023/0025/0026).
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'chat_message'"
        )


def downgrade() -> None:
    # Удаление значения из ENUM в Postgres официально не поддерживается;
    # downgrade оставляет 'chat_message' в типе — не критично.
    pass
