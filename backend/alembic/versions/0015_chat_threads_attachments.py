"""chat: threads + attachments (Этап 4)

Revision ID: 0015_chat_threads_attachments
Revises: 0014_chat_groups_reactions
Create Date: 2026-05-26

Этап 4 плана внедрения чата. Два изменения:

  1. В `chat_messages` добавляем `parent_message_id` (uuid nullable, FK self
     ON DELETE SET NULL). По решению §6 — треды глубиной 1, поэтому
     `parent_message_id` и есть «корень треда»; никакого отдельного
     `thread_root_id` не вводим. Ответ на ответ всё равно ссылается на тот
     же корень.

  2. В существующий enum `file_entity_type` добавляем значение `chat_message`
     — чтобы вложения в сообщения шли через тот же files-pipeline
     (S3-presign + ClamAV-скан + единая таблица `files`). Никакой новой
     таблицы для вложений не нужно (см. §2.2 плана).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015_chat_threads_attachments"
down_revision: str | Sequence[str] | None = "0014_chat_groups_reactions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column(
            "parent_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chat_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_chat_messages_parent",
        "chat_messages",
        ["parent_message_id"],
    )

    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE file_entity_type ADD VALUE IF NOT EXISTS 'chat_message'"
        )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_parent", table_name="chat_messages")
    op.drop_column("chat_messages", "parent_message_id")
    # Удаление значения из ENUM в Postgres не поддерживается официально —
    # 'chat_message' остаётся в file_entity_type. Не критично.
