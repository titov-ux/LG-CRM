"""роль «Менеджер по продажам» (sales_manager)

Revision ID: 0039_sales_manager_role
Revises: 0038_merge_login_snapshots
Create Date: 2026-10-07

Добавляет значение `sales_manager` в enum `user_role`. ALTER TYPE … ADD VALUE
идёт вне транзакции (autocommit_block, как в 0036_hr_edo).

Строку матрицы `leads.access` и ключ `sales_manager` в существующих строках
доливает `permissions.service._sync_missing_defaults` при первом чтении
матрицы — миграция данные матрицы не трогает.

PostgreSQL не умеет удалять значение из enum, поэтому downgrade — no-op.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0039_sales_manager_role"
down_revision: str | Sequence[str] | None = "0038_merge_login_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'sales_manager'")


def downgrade() -> None:
    # PostgreSQL не поддерживает удаление значения из enum — no-op.
    pass
