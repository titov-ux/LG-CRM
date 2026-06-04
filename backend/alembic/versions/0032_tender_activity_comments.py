"""tender: значения 'tender' в enum'ах activity/comment/notification

Revision ID: 0032_tender_activity_comments
Revises: 0031_tenders
Create Date: 2026-06-05

Включает историю взаимодействий и комментарии для тендеров: добавляет значение
'tender' в три enum-типа. ALTER TYPE … ADD VALUE — postgres-специфично и должно
идти вне транзакции, поэтому используем autocommit_block (как в 0013/0023/0028).

PostgreSQL не умеет удалять значение из enum, поэтому downgrade — no-op
(значения остаются, на работу не влияют). Тот же подход, что в миграциях,
добавлявших chat_message/event в notification_entity_type.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0032_tender_activity_comments"
down_revision: str | Sequence[str] | None = "0031_tenders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE activity_entity_type ADD VALUE IF NOT EXISTS 'tender'"
        )
        op.execute(
            "ALTER TYPE comment_entity_type ADD VALUE IF NOT EXISTS 'tender'"
        )
        op.execute(
            "ALTER TYPE notification_entity_type ADD VALUE IF NOT EXISTS 'tender'"
        )


def downgrade() -> None:
    # PostgreSQL не поддерживает удаление значения из enum — no-op.
    pass
