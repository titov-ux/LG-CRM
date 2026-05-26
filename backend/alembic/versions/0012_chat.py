"""chat: conversations + members + messages (Этап 1)

Revision ID: 0012_chat
Revises: 0011_user_fk_set_null
Create Date: 2026-05-26

Этап 1 плана внедрения чата (см. План_внедрения_чата.docx §2.2). Заводим
минимум: личные/групповые диалоги, мембершип, сообщения. Реакции, треды,
FTS, read-state и архивирование — добавятся в миграциях 0013–0016.

Ключевые решения (§6 плана):
  - chat_members.user_id → ON DELETE CASCADE (отличается от общего правила
    SET NULL, см. crm-lg-user-fk-set-null). Мембершип бессмыслен без юзера.
  - chat_messages.author_user_id → ON DELETE SET NULL (общее правило):
    сообщения «бывшего сотрудника» остаются в истории.
  - Уникальность DM-пары — частичный UNIQUE по (sorted_pair_hash) с
    предикатом kind='dm'. Сервис вычисляет хэш как md5(min(uuid)||max(uuid)).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_chat"
down_revision: str | Sequence[str] | None = "0011_user_fk_set_null"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CONVERSATION_KINDS = ("dm", "group")
MEMBER_ROLES = ("owner", "member")


def upgrade() -> None:
    postgresql.ENUM(
        *CONVERSATION_KINDS, name="chat_conversation_kind", create_type=True
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        *MEMBER_ROLES, name="chat_member_role", create_type=True
    ).create(op.get_bind(), checkfirst=True)

    # === conversations =====================================================
    op.create_table(
        "chat_conversations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "kind",
            postgresql.ENUM(
                *CONVERSATION_KINDS,
                name="chat_conversation_kind",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # md5(min(uuid)||max(uuid)) для DM-пары; NULL для group.
        sa.Column("sorted_pair_hash", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_chat_conversations_kind", "chat_conversations", ["kind"]
    )
    op.create_index(
        "ix_chat_conversations_last_message_at",
        "chat_conversations",
        ["last_message_at"],
    )
    # Частичный UNIQUE на пары DM — два юзера не могут иметь два разных DM.
    op.create_index(
        "uq_chat_conversations_dm_pair",
        "chat_conversations",
        ["sorted_pair_hash"],
        unique=True,
        postgresql_where=sa.text("kind = 'dm'"),
    )

    # === members ===========================================================
    op.create_table(
        "chat_members",
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chat_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            # CASCADE — мембершипы пропадают вместе с юзером (см. §6 плана).
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "role",
            postgresql.ENUM(
                *MEMBER_ROLES, name="chat_member_role", create_type=False
            ),
            nullable=False,
            server_default="member",
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "conversation_id", "user_id", name="chat_members_pkey"
        ),
    )
    op.create_index("ix_chat_members_user_id", "chat_members", ["user_id"])

    # === messages ==========================================================
    op.create_table(
        "chat_messages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chat_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # Основная выдача: история диалога сверху-вниз по времени.
    op.create_index(
        "ix_chat_messages_conv_created",
        "chat_messages",
        ["conversation_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_chat_messages_author", "chat_messages", ["author_user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_author", table_name="chat_messages")
    op.drop_index("ix_chat_messages_conv_created", table_name="chat_messages")
    op.drop_table("chat_messages")

    op.drop_index("ix_chat_members_user_id", table_name="chat_members")
    op.drop_table("chat_members")

    op.drop_index(
        "uq_chat_conversations_dm_pair", table_name="chat_conversations"
    )
    op.drop_index(
        "ix_chat_conversations_last_message_at",
        table_name="chat_conversations",
    )
    op.drop_index(
        "ix_chat_conversations_kind", table_name="chat_conversations"
    )
    op.drop_table("chat_conversations")

    op.execute("DROP TYPE IF EXISTS chat_member_role")
    op.execute("DROP TYPE IF EXISTS chat_conversation_kind")
