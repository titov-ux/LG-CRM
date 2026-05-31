"""notification kind: comment

Revision ID: 0026_notification_comment
Revises: 0025_notification_assignment
Create Date: 2026-05-31

Добавляем значение `comment` в enum `notification_kind` — уведомление
назначенному рекрутеру о новом комментарии к кандидату/вакансии
(см. comments/service.py: create_comment).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0026_notification_comment"
down_revision: str | Sequence[str] | None = "0025_notification_assignment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ALTER TYPE … ADD VALUE — postgres-специфично и должно идти вне транзакции,
    # поэтому используем autocommit_block (как в 0013/0023/0025).
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'comment'"
        )


def downgrade() -> None:
    # Удаление значения из ENUM в Postgres официально не поддерживается;
    # downgrade оставляет 'comment' в типе — не критично.
    pass
