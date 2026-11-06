"""currency: валюта расчётов с клиентом (RUB / USD)

Revision ID: 0043_currency
Revises: 0042_tasks
Create Date: 2026-11-06

Иностранные заказчики платят в долларах. Валюта — свойство клиента
(`clients.currency`); вакансии хранят копию (`vacancies.currency`), чтобы
ставку клиента (`rate_client`) можно было читать без JOIN. Сервис держит
копию в синхроне с клиентом (создание вакансии, смена клиента у вакансии,
смена валюты клиента).

Все существующие записи — RUB (server_default).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0043_currency"
down_revision: str | Sequence[str] | None = "0042_tasks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("clients", "vacancies"):
        op.add_column(
            table,
            sa.Column("currency", sa.String(3), nullable=False, server_default="RUB"),
        )
        op.create_check_constraint(
            f"ck_{table}_currency", table, "currency IN ('RUB', 'USD')"
        )


def downgrade() -> None:
    for table in ("clients", "vacancies"):
        op.drop_constraint(f"ck_{table}_currency", table, type_="check")
        op.drop_column(table, "currency")
