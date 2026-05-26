"""documents

Revision ID: 0018_documents
Revises: 0017_chat_mute_archive
Create Date: 2026-05-27
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018_documents"
down_revision: str | Sequence[str] | None = "0017_chat_mute_archive"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DOCUMENT_SECTIONS = (
    "clients",
    "regulations",
    "company",
    "employees",
    "contractors",
    "tender",
    "general",
)

DOCUMENT_KINDS = ("doc", "pdf", "xlsx", "pptx", "image", "folder", "note")


def upgrade() -> None:
    postgresql.ENUM(*DOCUMENT_SECTIONS, name="document_section_id", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*DOCUMENT_KINDS, name="document_kind", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "documents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("emoji", sa.String(length=16), nullable=False),
        sa.Column(
            "kind",
            postgresql.ENUM(*DOCUMENT_KINDS, name="document_kind", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "section",
            postgresql.ENUM(*DOCUMENT_SECTIONS, name="document_section_id", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String(length=64)), nullable=False, server_default=sa.text("'{}'::varchar[]")),
        sa.Column(
            "owner_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_documents_kind", "documents", ["kind"])
    op.create_index("ix_documents_section", "documents", ["section"])
    op.create_index("ix_documents_parent_id", "documents", ["parent_id"])
    op.create_index("ix_documents_owner_user_id", "documents", ["owner_user_id"])

    op.create_table(
        "document_favorites",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("document_id", "user_id", name="uq_document_favorites_doc_user"),
    )
    op.create_index("ix_document_favorites_document_id", "document_favorites", ["document_id"])
    op.create_index("ix_document_favorites_user_id", "document_favorites", ["user_id"])

    op.create_table(
        "document_versions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"])
    op.create_index("ix_document_versions_author_user_id", "document_versions", ["author_user_id"])

    op.create_table(
        "document_comments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_document_comments_document_id", "document_comments", ["document_id"])
    op.create_index("ix_document_comments_author_user_id", "document_comments", ["author_user_id"])


def downgrade() -> None:
    op.drop_index("ix_document_comments_author_user_id", table_name="document_comments")
    op.drop_index("ix_document_comments_document_id", table_name="document_comments")
    op.drop_table("document_comments")

    op.drop_index("ix_document_versions_author_user_id", table_name="document_versions")
    op.drop_index("ix_document_versions_document_id", table_name="document_versions")
    op.drop_table("document_versions")

    op.drop_index("ix_document_favorites_user_id", table_name="document_favorites")
    op.drop_index("ix_document_favorites_document_id", table_name="document_favorites")
    op.drop_table("document_favorites")

    op.drop_index("ix_documents_owner_user_id", table_name="documents")
    op.drop_index("ix_documents_parent_id", table_name="documents")
    op.drop_index("ix_documents_section", table_name="documents")
    op.drop_index("ix_documents_kind", table_name="documents")
    op.drop_table("documents")

    op.execute("DROP TYPE IF EXISTS document_kind")
    op.execute("DROP TYPE IF EXISTS document_section_id")

