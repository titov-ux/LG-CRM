"""chat: full-text search (Этап 5)

Revision ID: 0016_chat_search
Revises: 0015_chat_threads_attachments
Create Date: 2026-05-26

Этап 5 плана внедрения чата. По §6 — `simple+russian` без `pg_trgm`:
русской лемматизации Postgres хватает для словоформ («тестирую» / «тестировал»
/ «тестирование» матчатся по «тест»). pg_trgm добавим позже, если будет
жалоба на «не находит при опечатках».

Изменения:
  1. `chat_messages.tsv` (tsvector, nullable, GIN-индекс).
  2. Триггер BEFORE INSERT OR UPDATE OF text — пересчитывает tsv через
     `to_tsvector('russian', coalesce(text, ''))`.
  3. Backfill: одним UPDATE проставляем tsv для существующих сообщений.

`russian`-конфиг есть в стоковом Postgres (см. `pg_ts_config`). Если миграция
запускается на инстансе с локалью не-`ru_*` — конфиг всё равно работает,
т.к. словари не зависят от системной локали (snowball + stop-list).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016_chat_search"
down_revision: str | Sequence[str] | None = "0015_chat_threads_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("tsv", postgresql.TSVECTOR(), nullable=True),
    )
    op.create_index(
        "ix_chat_messages_tsv",
        "chat_messages",
        ["tsv"],
        postgresql_using="gin",
    )
    # Триггер на пересчёт tsv. Стандартный helper Postgres `tsvector_update_trigger`
    # не подходит — он не игнорирует NULL текст и берёт колонку без coalesce.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION chat_messages_tsv_refresh()
        RETURNS trigger AS $$
        BEGIN
            NEW.tsv := to_tsvector('russian', coalesce(NEW.text, ''));
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER chat_messages_tsv_trigger
        BEFORE INSERT OR UPDATE OF text ON chat_messages
        FOR EACH ROW EXECUTE FUNCTION chat_messages_tsv_refresh();
        """
    )
    # Backfill для существующих строк (пустая таблица — no-op).
    op.execute(
        "UPDATE chat_messages SET tsv = to_tsvector('russian', coalesce(text, ''))"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS chat_messages_tsv_trigger ON chat_messages")
    op.execute("DROP FUNCTION IF EXISTS chat_messages_tsv_refresh()")
    op.drop_index("ix_chat_messages_tsv", table_name="chat_messages")
    op.drop_column("chat_messages", "tsv")
