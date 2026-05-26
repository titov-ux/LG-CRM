"""chat: mute + archive (Этап 6)

Revision ID: 0017_chat_mute_archive
Revises: 0016_chat_search
Create Date: 2026-05-27

Полировка по §3 «Этап 6» плана:

  • `chat_members.muted_until` — выключает уведомления, но не realtime-доставку.
    Удобно для «отписаться от шумного чата на неделю». NULL = mute выключен.
  • `chat_members.hidden_at` — архив для самого юзера: диалог скрыт из списка
    `GET /chat/conversations`. По Slack-конвенции новое сообщение в архив
    автоматически возвращает диалог в список (сбрасываем hidden_at в
    `post_message`). NULL = в активном списке.

Никаких индексов: оба поля читаются только по PK (conversation_id, user_id).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_chat_mute_archive"
down_revision: str | Sequence[str] | None = "0016_chat_search"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_members",
        sa.Column("muted_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "chat_members",
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_members", "hidden_at")
    op.drop_column("chat_members", "muted_until")
