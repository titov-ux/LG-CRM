"""chat: read-state, edit/delete, mentions (Этап 2)

Revision ID: 0013_chat_read
Revises: 0012_chat
Create Date: 2026-05-26

Этап 2 плана внедрения чата (см. План_внедрения_чата.docx §3 «Этап 2»).
Здесь два изменения:

  1. В `chat_members` добавляем поля для read-state: `last_read_message_id`
     (uuid nullable, FK → chat_messages.id ON DELETE SET NULL) и
     `last_read_at` (timestamp nullable). По ним фронт считает unread-badge
     и подсвечивает диалог в списке.
  2. В существующий enum `notification_entity_type` добавляем значение
     `chat_message` — чтобы упоминания в чате создавали Notification со
     ссылкой на конкретное сообщение.

Колонки `edited_at` и `deleted_at` для chat_messages уже заведены в 0012,
дополнительной миграции не требуется.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_chat_read"
down_revision: str | Sequence[str] | None = "0012_chat"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_members",
        sa.Column(
            "last_read_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chat_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "chat_members",
        sa.Column(
            "last_read_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # ALTER TYPE … ADD VALUE — это postgres-специфичное и должно идти вне
    # транзакции, поэтому используем autocommit_block.
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE notification_entity_type ADD VALUE IF NOT EXISTS 'chat_message'"
        )


def downgrade() -> None:
    op.drop_column("chat_members", "last_read_at")
    op.drop_column("chat_members", "last_read_message_id")
    # Удаление значения из ENUM в Postgres официально не поддерживается;
    # downgrade оставляет 'chat_message' в типе — не критично, новое
    # приложение его просто не будет писать.
