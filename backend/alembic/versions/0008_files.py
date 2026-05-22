"""files

Revision ID: 0008_files
Revises: 0007_comments_audit
Create Date: 2026-05-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_files"
down_revision: str | Sequence[str] | None = "0007_comments_audit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


FILE_ENTITY_TYPES = ("candidate", "vacancy", "client", "contact")
SCAN_STATUSES = ("pending", "clean", "infected", "error")


def upgrade() -> None:
    postgresql.ENUM(*FILE_ENTITY_TYPES, name="file_entity_type", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*SCAN_STATUSES, name="scan_status", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "files",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "owner_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "entity_type",
            postgresql.ENUM(*FILE_ENTITY_TYPES, name="file_entity_type", create_type=False),
            nullable=False,
        ),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_key", sa.String(length=1024), nullable=False, unique=True),
        sa.Column("original_name", sa.String(length=512), nullable=False),
        sa.Column("mime", sa.String(length=255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column(
            "scan_status",
            postgresql.ENUM(*SCAN_STATUSES, name="scan_status", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=True),
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
    op.create_index("ix_files_owner_user_id", "files", ["owner_user_id"])
    op.create_index("ix_files_entity", "files", ["entity_type", "entity_id"])


def downgrade() -> None:
    op.drop_index("ix_files_entity", table_name="files")
    op.drop_index("ix_files_owner_user_id", table_name="files")
    op.drop_table("files")
    op.execute("DROP TYPE IF EXISTS scan_status")
    op.execute("DROP TYPE IF EXISTS file_entity_type")
