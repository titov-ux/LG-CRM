"""leads: канбан-доска лидов (будущие клиенты)

Revision ID: 0037_leads
Revises: 0036_hr_edo
Create Date: 2026-10-07

Таблица лидов с собственным пайплайном статусов
(new → contacted → qualified → proposal → negotiation → won/lost) и
контактами потенциального клиента. Приоритет переиспользует существующий enum
`priority` (create_type=False — не пересоздаём тип).

FK на users.id / clients.id — SET NULL + nullable (паттерн миграции 0011).

Также добавляет значение 'lead' в enum'ы activity/comment/notification —
история взаимодействий и комментарии на карточке лида. ALTER TYPE … ADD VALUE
идёт вне транзакции (autocommit_block, как в 0032); downgrade эти значения
не удаляет — PostgreSQL так не умеет.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0037_leads"
down_revision: str | Sequence[str] | None = "0036_hr_edo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEAD_STATUS = ("new", "contacted", "qualified", "proposal", "negotiation", "won", "lost")


def upgrade() -> None:
    postgresql.ENUM(*LEAD_STATUS, name="lead_status", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "leads",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("company", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("industry", sa.String(length=255), nullable=True),
        sa.Column("website", sa.String(length=1000), nullable=True),
        sa.Column("contact_name", sa.String(length=255), nullable=True),
        sa.Column("contact_position", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=100), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("telegram", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=255), nullable=True),
        sa.Column("expected_value", sa.Numeric(16, 2), nullable=True),
        sa.Column("next_contact_date", sa.Date(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(*LEAD_STATUS, name="lead_status", create_type=False),
            nullable=False,
            server_default="new",
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
            "client_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clients.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("kanban_order", sa.Integer(), nullable=False, server_default="0"),
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
    op.create_index("ix_leads_status", "leads", ["status"])
    op.create_index("ix_leads_account_manager_id", "leads", ["account_manager_id"])
    op.create_index("ix_leads_deleted_at", "leads", ["deleted_at"])

    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE activity_entity_type ADD VALUE IF NOT EXISTS 'lead'")
        op.execute("ALTER TYPE comment_entity_type ADD VALUE IF NOT EXISTS 'lead'")
        op.execute("ALTER TYPE notification_entity_type ADD VALUE IF NOT EXISTS 'lead'")


def downgrade() -> None:
    op.drop_index("ix_leads_deleted_at", table_name="leads")
    op.drop_index("ix_leads_account_manager_id", table_name="leads")
    op.drop_index("ix_leads_status", table_name="leads")
    op.drop_table("leads")
    postgresql.ENUM(name="lead_status").drop(op.get_bind(), checkfirst=True)
