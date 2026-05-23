"""comments + activity_log + audit_log

Revision ID: 0007_comments_audit
Revises: 0006_vacancy_candidates
Create Date: 2026-05-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_comments_audit"
down_revision: str | Sequence[str] | None = "0006_vacancy_candidates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMMENT_ENTITY_TYPES = ("contact", "candidate", "vacancy", "client")
ACTIVITY_ENTITY_TYPES = ("vacancy", "candidate", "client")
ACTIVITY_KINDS = ("create", "status", "note", "call", "email")


def upgrade() -> None:
    postgresql.ENUM(*COMMENT_ENTITY_TYPES, name="comment_entity_type", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*ACTIVITY_ENTITY_TYPES, name="activity_entity_type", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*ACTIVITY_KINDS, name="activity_kind", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "comments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "entity_type",
            postgresql.ENUM(*COMMENT_ENTITY_TYPES, name="comment_entity_type", create_type=False),
            nullable=False,
        ),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "mentions",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default=sa.text("'{}'::uuid[]"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_comments_entity", "comments", ["entity_type", "entity_id"])
    op.create_index("ix_comments_created_at", "comments", ["created_at"])

    op.create_table(
        "activity_log",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "entity_type",
            postgresql.ENUM(*ACTIVITY_ENTITY_TYPES, name="activity_entity_type", create_type=False),
            nullable=False,
        ),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "kind",
            postgresql.ENUM(*ACTIVITY_KINDS, name="activity_kind", create_type=False),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_activity_entity", "activity_log", ["entity_type", "entity_id"])
    op.create_index("ix_activity_created_at", "activity_log", ["created_at"])

    op.create_table(
        "audit_log",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("field", sa.String(length=64), nullable=False),
        sa.Column("before", sa.Text(), nullable=True),
        sa.Column("after", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_audit_entity", "audit_log", ["entity_type", "entity_id"])
    op.create_index("ix_audit_actor", "audit_log", ["actor_id"])
    op.create_index("ix_audit_created_at", "audit_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_created_at", table_name="audit_log")
    op.drop_index("ix_audit_actor", table_name="audit_log")
    op.drop_index("ix_audit_entity", table_name="audit_log")
    op.drop_table("audit_log")

    op.drop_index("ix_activity_created_at", table_name="activity_log")
    op.drop_index("ix_activity_entity", table_name="activity_log")
    op.drop_table("activity_log")

    op.drop_index("ix_comments_created_at", table_name="comments")
    op.drop_index("ix_comments_entity", table_name="comments")
    op.drop_table("comments")

    op.execute("DROP TYPE IF EXISTS activity_kind")
    op.execute("DROP TYPE IF EXISTS activity_entity_type")
    op.execute("DROP TYPE IF EXISTS comment_entity_type")
