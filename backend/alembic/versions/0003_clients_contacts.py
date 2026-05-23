"""clients + legal_entities + contacts

Revision ID: 0003_clients_contacts
Revises: 0002_permissions_matrix
Create Date: 2026-05-22

Этап 3 плана перехода на API.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_clients_contacts"
down_revision: str | Sequence[str] | None = "0002_permissions_matrix"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CLIENT_STATUSES = ("lead", "in_progress", "active", "paused", "archived")
CLIENT_KINDS = ("direct", "intermediary")


def upgrade() -> None:
    client_status = postgresql.ENUM(*CLIENT_STATUSES, name="client_status", create_type=True)
    client_kind = postgresql.ENUM(*CLIENT_KINDS, name="client_kind", create_type=True)
    client_status.create(op.get_bind(), checkfirst=True)
    client_kind.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "clients",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("industry", sa.String(length=255), nullable=False, server_default=""),
        sa.Column(
            "account_manager_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(*CLIENT_STATUSES, name="client_status", create_type=False),
            nullable=False,
            server_default="lead",
        ),
        sa.Column(
            "client_kind",
            postgresql.ENUM(*CLIENT_KINDS, name="client_kind", create_type=False),
            nullable=False,
            server_default="direct",
        ),
        sa.Column("telegram_chat", sa.String(length=255), nullable=True),
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
    op.create_index("ix_clients_account_manager_id", "clients", ["account_manager_id"])
    op.create_index("ix_clients_status", "clients", ["status"])
    op.create_index("ix_clients_client_kind", "clients", ["client_kind"])
    op.create_index("ix_clients_deleted_at", "clients", ["deleted_at"])
    # Триграммный индекс под поиск по названию.
    op.execute(
        "CREATE INDEX ix_clients_name_trgm ON clients USING gin (name gin_trgm_ops)"
    )

    op.create_table(
        "legal_entities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "client_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clients.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("inn", sa.String(length=32), nullable=False),
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
    op.create_index("ix_legal_entities_client_id", "legal_entities", ["client_id"])
    op.create_index("ix_legal_entities_inn", "legal_entities", ["inn"])

    op.create_table(
        "contacts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "client_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clients.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("telegram", sa.String(length=255), nullable=True),
        sa.Column("birthday", sa.Date(), nullable=True),
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
    op.create_index("ix_contacts_client_id", "contacts", ["client_id"])
    op.create_index("ix_contacts_deleted_at", "contacts", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_contacts_deleted_at", table_name="contacts")
    op.drop_index("ix_contacts_client_id", table_name="contacts")
    op.drop_table("contacts")
    op.drop_index("ix_legal_entities_inn", table_name="legal_entities")
    op.drop_index("ix_legal_entities_client_id", table_name="legal_entities")
    op.drop_table("legal_entities")
    op.execute("DROP INDEX IF EXISTS ix_clients_name_trgm")
    op.drop_index("ix_clients_deleted_at", table_name="clients")
    op.drop_index("ix_clients_client_kind", table_name="clients")
    op.drop_index("ix_clients_status", table_name="clients")
    op.drop_index("ix_clients_account_manager_id", table_name="clients")
    op.drop_table("clients")
    op.execute("DROP TYPE IF EXISTS client_kind")
    op.execute("DROP TYPE IF EXISTS client_status")
