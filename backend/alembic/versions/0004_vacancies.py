"""vacancies + vacancy_recruiters

Revision ID: 0004_vacancies
Revises: 0003_clients_contacts
Create Date: 2026-05-22

Этап 4 плана перехода на API.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_vacancies"
down_revision: str | Sequence[str] | None = "0003_clients_contacts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ENGAGEMENT_TYPES = ("outstaff", "agency")
GRADES = ("Junior", "Middle", "Senior", "Lead")
WORK_FORMATS = ("Удалённо", "Гибрид", "Офис")
PRIORITIES = ("low", "medium", "high", "urgent")
VACANCY_STATUSES = (
    "new",
    "in_work",
    "proposed",
    "interview",
    "waiting_os",
    "closed_success",
    "closed",
    "paused",
)


def _ensure_type(name: str, values: tuple[str, ...]) -> None:
    postgresql.ENUM(*values, name=name, create_type=True).create(op.get_bind(), checkfirst=True)


def upgrade() -> None:
    _ensure_type("engagement_type", ENGAGEMENT_TYPES)
    _ensure_type("grade", GRADES)
    _ensure_type("work_format", WORK_FORMATS)
    _ensure_type("priority", PRIORITIES)
    _ensure_type("vacancy_status", VACANCY_STATUSES)

    op.create_table(
        "vacancies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column(
            "client_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "engagement_type",
            postgresql.ENUM(*ENGAGEMENT_TYPES, name="engagement_type", create_type=False),
            nullable=False,
            server_default="outstaff",
        ),
        sa.Column("project", sa.String(length=255), nullable=True),
        sa.Column(
            "grade",
            postgresql.ENUM(*GRADES, name="grade", create_type=False),
            nullable=False,
            server_default="Middle",
        ),
        sa.Column(
            "stack",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column(
            "format",
            postgresql.ENUM(*WORK_FORMATS, name="work_format", create_type=False),
            nullable=False,
            server_default="Гибрид",
        ),
        sa.Column("rate_client", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("salary_max", sa.Numeric(12, 2), nullable=True),
        sa.Column("positions", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "status",
            postgresql.ENUM(*VACANCY_STATUSES, name="vacancy_status", create_type=False),
            nullable=False,
            server_default="new",
        ),
        sa.Column(
            "priority",
            postgresql.ENUM(*PRIORITIES, name="priority", create_type=False),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "account_manager_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "status_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("kanban_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("requirements", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_vacancies_client_id", "vacancies", ["client_id"])
    op.create_index("ix_vacancies_account_manager_id", "vacancies", ["account_manager_id"])
    op.create_index("ix_vacancies_status", "vacancies", ["status"])
    op.create_index("ix_vacancies_deleted_at", "vacancies", ["deleted_at"])
    # Композитные индексы из плана: «status, account_manager_id» / «status, recruiter_id»
    op.create_index(
        "ix_vacancies_status_account_manager",
        "vacancies",
        ["status", "account_manager_id"],
    )
    # GIN-индекс по stack (Postgres ARRAY)
    op.execute("CREATE INDEX ix_vacancies_stack_gin ON vacancies USING gin (stack)")
    # Триграммный индекс по title — поиск по подстроке.
    op.execute("CREATE INDEX ix_vacancies_title_trgm ON vacancies USING gin (title gin_trgm_ops)")

    op.create_table(
        "vacancy_recruiters",
        sa.Column(
            "vacancy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vacancies.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.UniqueConstraint("vacancy_id", "user_id", name="uq_vacancy_recruiter"),
    )
    op.create_index("ix_vacancy_recruiters_user_id", "vacancy_recruiters", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_vacancy_recruiters_user_id", table_name="vacancy_recruiters")
    op.drop_table("vacancy_recruiters")
    op.execute("DROP INDEX IF EXISTS ix_vacancies_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_vacancies_stack_gin")
    op.drop_index("ix_vacancies_status_account_manager", table_name="vacancies")
    op.drop_index("ix_vacancies_deleted_at", table_name="vacancies")
    op.drop_index("ix_vacancies_status", table_name="vacancies")
    op.drop_index("ix_vacancies_account_manager_id", table_name="vacancies")
    op.drop_index("ix_vacancies_client_id", table_name="vacancies")
    op.drop_table("vacancies")
    for name in ("vacancy_status", "priority", "work_format", "grade", "engagement_type"):
        op.execute(f"DROP TYPE IF EXISTS {name}")
