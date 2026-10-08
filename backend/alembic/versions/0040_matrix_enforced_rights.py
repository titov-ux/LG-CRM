"""матрица прав: client:delete и аналитика под фактическое поведение

Revision ID: 0040_matrix_enforced_rights
Revises: 0039_sales_manager_role
Create Date: 2026-10-08

Клиенты, вакансии, календарь и «Аналитика» (учёт времени) теперь проверяют
права по матрице `permissions_matrix`, а не по захардкоженным ролям. Чтобы
переключение не изменило доступ само по себе:

* `clients.delete` получает действие `client:delete` — раньше строка была без
  действий, и галочка ни на что не влияла (удалять мог только admin, что
  совпадает с дефолтом строки).
* `analytics.view`: бэкенд пускал в учёт времени только admin, хотя в матрице
  галочки стояли и у account_manager / viewer. Эти «мёртвые» галочки
  выключаем (account_manager, recruiter, viewer, accountant → false), чтобы
  раздел не открылся им после перехода на матрицу. admin и sales_manager не
  трогаем — для менеджера по продажам аналитику включили осознанно.

Остальные строки (`clients.create_edit`, `vacancies.*`, `calendar.*`) уже
совпадают с прежними ролевыми проверками — их не меняем.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0040_matrix_enforced_rights"
down_revision: str | Sequence[str] | None = "0039_sales_manager_role"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ANALYTICS_OFF = ("account_manager", "recruiter", "viewer", "accountant")


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE permissions_matrix SET actions = CAST(:a AS jsonb) WHERE id = 'clients.delete'"
        ).bindparams(a='["client:delete"]')
    )
    op.execute(
        sa.text(
            "UPDATE permissions_matrix SET description = :d WHERE id = 'analytics.view'"
        ).bindparams(d="Раздел «Аналитика»: учёт рабочего времени сотрудников.")
    )
    for role in _ANALYTICS_OFF:
        op.execute(
            sa.text(
                "UPDATE permissions_matrix "
                "SET matrix = jsonb_set(matrix::jsonb, CAST(:path AS text[]), 'false'::jsonb) "
                "WHERE id = 'analytics.view' AND matrix::jsonb ? :role"
            ).bindparams(path="{" + role + "}", role=role)
        )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE permissions_matrix SET actions = CAST('[]' AS jsonb) WHERE id = 'clients.delete'"
        )
    )
