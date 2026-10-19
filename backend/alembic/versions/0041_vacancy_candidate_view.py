"""права vacancy:view / candidate:view; закрыть их менеджеру по продажам

Revision ID: 0041_vacancy_candidate_view
Revises: 0040_matrix_enforced_rights
Create Date: 2026-10-19

Строки `vacancies.view_all` и `candidates.view` были без действий — галочки ни
на что не влияли, разделы были открыты всем. Теперь они гейтят весь раздел:

* `vacancies.view_all` → «Доступ к вакансиям», действие `vacancy:view`
  (доска, карточки, вакансии в карточке клиента, API /vacancies).
* `candidates.view` → «Доступ к кандидатам», действие `candidate:view`
  (доска, «Все кандидаты», карточки, API /candidates).

Менеджеру по продажам (sales_manager) оба права выключаем. Остальным ролям
значения не трогаем — у них раздел остаётся как был.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0041_vacancy_candidate_view"
down_revision: str | Sequence[str] | None = "0040_matrix_enforced_rights"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ROWS = {
    "vacancies.view_all": (
        "vacancy:view",
        "Доступ к вакансиям",
        "Раздел «Вакансии»: доска и карточки вакансий, вакансии в карточке клиента.",
    ),
    "candidates.view": (
        "candidate:view",
        "Доступ к кандидатам",
        "Доска «Кандидаты», база «Все кандидаты» и карточки кандидатов.",
    ),
}

_OLD = {
    "vacancies.view_all": (
        "Просмотр всех вакансий",
        "Видеть все вакансии компании, а не только свои.",
    ),
    "candidates.view": (
        "Просмотр базы кандидатов",
        "Поиск и фильтрация кандидатов.",
    ),
}


def upgrade() -> None:
    for row_id, (action, permission, description) in _ROWS.items():
        op.execute(
            sa.text(
                "UPDATE permissions_matrix "
                "SET actions = CAST(:a AS jsonb), permission = :p, description = :d "
                "WHERE id = :id"
            ).bindparams(a=f'["{action}"]', p=permission, d=description, id=row_id)
        )
        # jsonb_set без create_missing=false добавит ключ, если его ещё нет.
        op.execute(
            sa.text(
                "UPDATE permissions_matrix "
                "SET matrix = jsonb_set(matrix::jsonb, '{sales_manager}', 'false'::jsonb) "
                "WHERE id = :id"
            ).bindparams(id=row_id)
        )


def downgrade() -> None:
    for row_id, (permission, description) in _OLD.items():
        op.execute(
            sa.text(
                "UPDATE permissions_matrix "
                "SET actions = CAST('[]' AS jsonb), permission = :p, description = :d "
                "WHERE id = :id"
            ).bindparams(p=permission, d=description, id=row_id)
        )
