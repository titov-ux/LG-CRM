"""chat: reactions (Этап 3)

Revision ID: 0014_chat_groups_reactions
Revises: 0013_chat_read
Create Date: 2026-05-26

Этап 3 плана внедрения чата (см. План_внедрения_чата.docx §3 «Этап 3»).
Группы как таковые уже доступны на уровне БД с миграции 0012 (kind='group',
title nullable) — этой миграцией добавляется только таблица реакций.

`chat_message_reactions`:
  - PK (message_id, user_id, emoji) — каждый юзер может поставить любое
    количество разных эмодзи, но не дублировать одну и ту же.
  - Все FK с CASCADE: исчезло сообщение / юзер — реакции тоже.
  - Индекс по message_id — для быстрой выборки «все реакции этого сообщения».
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_chat_groups_reactions"
down_revision: str | Sequence[str] | None = "0013_chat_read"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_message_reactions",
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # 64 символа — хватит и на компоновные эмодзи (varselectors,
        # ZWJ-секвенции, скин-тоны), которые занимают до 30+ байт в UTF-8.
        sa.Column("emoji", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "message_id", "user_id", "emoji", name="chat_message_reactions_pkey"
        ),
    )
    op.create_index(
        "ix_chat_message_reactions_message",
        "chat_message_reactions",
        ["message_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_chat_message_reactions_message",
        table_name="chat_message_reactions",
    )
    op.drop_table("chat_message_reactions")
