"""tenders: канбан-доска тендеров (госзакупки / коммерческие)

Revision ID: 0031_tenders
Revises: 0030_work_sessions_active_time
Create Date: 2026-06-05

Таблица тендеров с собственным пайплайном статусов
(lead → evaluation → bid → review → won/lost). Приоритет переиспользует
существующий enum `priority` (create_type=False — не пересоздаём тип).

FK на users.id — SET NULL + nullable (паттерн миграции 0011): удаление
ответственного не блокируется и не сносит тендер.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0031_tenders"
down_revision: str | Sequence[str] | None = "0030_work_sessions_active_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TENDER_STATUS = ("lead", "evaluation", "bid", "review", "won", "lost")
TENDER_LAW = ("fz44", "fz223", "commercial")


def upgrade() -> None:
    postgresql.ENUM(*TENDER_STATUS, name="tender_status", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*TENDER_LAW, name="tender_law", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "tenders",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("customer", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("registry_number", sa.String(length=100), nullable=True),
        sa.Column("platform", sa.String(length=255), nullable=True),
        sa.Column(
            "law",
            postgresql.ENUM(*TENDER_LAW, name="tender_law", create_type=False),
            nullable=False,
            server_default="fz44",
        ),
        sa.Column("nmck", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("our_price", sa.Numeric(16, 2), nullable=True),
        sa.Column("security_amount", sa.Numeric(16, 2), nullable=True),
        sa.Column("submission_deadline", sa.Date(), nullable=True),
        sa.Column("auction_date", sa.Date(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(*TENDER_STATUS, name="tender_status", create_type=False),
            nullable=False,
            server_default="lead",
        ),
        sa.Column(
            "priority",
            # Переиспользуем существующий enum `priority` — НЕ создаём заново.
            postgresql.ENUM("low", "medium", "high", "urgent", name="priority", create_type=False),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "account_manager_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("kanban_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("url", sa.String(length=1000), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
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
    op.create_index("ix_tenders_status", "tenders", ["status"])
    op.create_index("ix_tenders_account_manager_id", "tenders", ["account_manager_id"])
    op.create_index("ix_tenders_deleted_at", "tenders", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_tenders_deleted_at", table_name="tenders")
    op.drop_index("ix_tenders_account_manager_id", table_name="tenders")
    op.drop_index("ix_tenders_status", table_name="tenders")
    op.drop_table("tenders")
    postgresql.ENUM(name="tender_law").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="tender_status").drop(op.get_bind(), checkfirst=True)
