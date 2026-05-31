"""notification kind: assignment

Revision ID: 0025_notification_assignment
Revises: 0024_match_ai_scoring
Create Date: 2026-05-31

Добавляем значение `assignment` в enum `notification_kind` — уведомление о
назначении вакансии рекрутеру/ответственному (см. vacancies/service.py:
create_vacancy и update_vacancy).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0025_notification_assignment"
down_revision: str | Sequence[str] | None = "0024_match_ai_scoring"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ALTER TYPE … ADD VALUE — postgres-специфично и должно идти вне транзакции,
    # поэтому используем autocommit_block (как в 0013/0023).
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'assignment'"
        )


def downgrade() -> None:
    # Удаление значения из ENUM в Postgres официально не поддерживается;
    # downgrade оставляет 'assignment' в типе — не критично.
    pass
