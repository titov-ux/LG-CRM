"""user_fk_set_null

Revision ID: 0011_user_fk_set_null
Revises: 0010_password_invites
Create Date: 2026-05-26

Делает FK на users.id из всех бизнес-таблиц сбрасываемыми в NULL при удалении
пользователя. До этого FK были RESTRICT + колонки NOT NULL — поэтому удалить
пользователя, на которого «повешена» хоть одна вакансия / кандидат / клиент /
комментарий / запись активности / файл, было невозможно.

Затрагиваемые колонки (становятся nullable + ON DELETE SET NULL):
- vacancies.account_manager_id
- candidates.recruiter_id
- clients.account_manager_id
- comments.author_id
- activity_log.actor_id
- audit_log.actor_id
- files.owner_user_id

vacancy_recruiters.user_id уже CASCADE (M2M), отдельная запись просто исчезает.
candidates.archived_by_id уже SET NULL.
matching.vacancy_candidates.added_by_id уже SET NULL.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0011_user_fk_set_null"
down_revision: str | Sequence[str] | None = "0010_password_invites"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (table, column, fk_name) — fk_name по дефолту Postgres-овский <table>_<column>_fkey.
TARGETS: tuple[tuple[str, str, str], ...] = (
    ("vacancies", "account_manager_id", "vacancies_account_manager_id_fkey"),
    ("candidates", "recruiter_id", "candidates_recruiter_id_fkey"),
    ("clients", "account_manager_id", "clients_account_manager_id_fkey"),
    ("comments", "author_id", "comments_author_id_fkey"),
    ("activity_log", "actor_id", "activity_log_actor_id_fkey"),
    ("audit_log", "actor_id", "audit_log_actor_id_fkey"),
    ("files", "owner_user_id", "files_owner_user_id_fkey"),
)


def upgrade() -> None:
    for table, column, fk_name in TARGETS:
        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.alter_column(table, column, nullable=True)
        op.create_foreign_key(
            fk_name,
            table,
            "users",
            [column],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    # Откат предполагает, что во всех колонках нет NULL — иначе не сможем
    # вернуть NOT NULL. Это ожидаемо: downgrade пишут «на чистой» БД либо
    # руками сначала переназначают записи.
    for table, column, fk_name in TARGETS:
        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.alter_column(table, column, nullable=False)
        op.create_foreign_key(
            fk_name,
            table,
            "users",
            [column],
            ["id"],
            ondelete="RESTRICT",
        )
