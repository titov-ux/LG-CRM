"""SQLAlchemy-модели чата.

Соответствует §2.2 «План_внедрения_чата.docx». На Этапе 1 заводим минимум:
`chat_conversations` + `chat_members` + `chat_messages` без реакций, тредов
и FTS — это добавится миграциями 0013–0016 в последующих этапах.

Ключевые решения (см. §6 плана):
  - `chat_members.user_id` → ON DELETE CASCADE. Отличается от общего правила
    проекта (SET NULL, см. crm-lg-user-fk-set-null), но мембершип бессмыслен
    без юзера. Авторство в `chat_messages.author_user_id` — SET NULL, чтобы
    сообщения «бывшего сотрудника» оставались видимыми коллегам.
  - Уникальность DM-пары обеспечивается частичным UNIQUE-индексом по
    `sorted_pair_hash`, который сервис вычисляет как md5(min(uuid)||max(uuid)).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    PrimaryKeyConstraint,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ConversationKind(str, enum.Enum):
    dm = "dm"
    group = "group"


class ChatMemberRole(str, enum.Enum):
    owner = "owner"
    member = "member"


def _enum_values(e: type[enum.Enum]) -> list[str]:
    return [m.value for m in e]


class ChatConversation(Base):
    __tablename__ = "chat_conversations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    kind: Mapped[ConversationKind] = mapped_column(
        Enum(
            ConversationKind,
            name="chat_conversation_kind",
            values_callable=_enum_values,
        ),
        nullable=False,
        index=True,
    )
    # Для DM — обычно None (фронт строит заголовок из имени собеседника).
    # Для group — заголовок беседы.
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # При удалении создателя ставим NULL — диалог продолжает жить.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Хэш отсортированной пары user_id для DM (md5 нижнего||верхнего uuid).
    # Для group — NULL. Частичный UNIQUE-индекс (см. миграцию) запрещает
    # создавать два DM между одной и той же парой.
    sorted_pair_hash: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # Денормализация — обновляется сервисом при post_message; используется
    # для сортировки списка диалогов слева в UI.
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )


class ChatMember(Base):
    __tablename__ = "chat_members"
    __table_args__ = (
        PrimaryKeyConstraint("conversation_id", "user_id", name="chat_members_pkey"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # CASCADE — отличается от общего правила (см. §6 плана). При удалении
    # юзера его мембершипы пропадают; авторство сообщений остаётся (см.
    # ChatMessage.author_user_id).
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[ChatMemberRole] = mapped_column(
        Enum(
            ChatMemberRole,
            name="chat_member_role",
            values_callable=_enum_values,
        ),
        nullable=False,
        server_default=ChatMemberRole.member.value,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # Read-state (Этап 2). Хранится в членстве, чтобы у каждого юзера было
    # своё «последнее прочитанное» в этом диалоге. При удалении сообщения,
    # на которое указывает last_read_message_id, FK → SET NULL (см. 0013).
    last_read_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Этап 6: персональные настройки.
    # `muted_until` — если задан и > now(), Notification kind=mention для
    # этого юзера НЕ создаётся. Realtime-доставка сообщений работает как
    # обычно (юзер просто не получит push).
    muted_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # `hidden_at` — архив на стороне юзера: диалог скрыт из его списка
    # `GET /chat/conversations` (если не передан `?includeArchived=true`).
    # Новое сообщение в архивированный диалог сбрасывает hidden_at — это
    # Slack-конвенция «активность возвращает диалог в список».
    hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ChatMessageReaction(Base):
    """Реакция (эмодзи) одного юзера на одно сообщение (Этап 3).

    PK по триаде (message_id, user_id, emoji) — каждый юзер может ставить
    разные эмодзи на одно и то же сообщение, но не дублировать одну и ту же.
    """

    __tablename__ = "chat_message_reactions"
    __table_args__ = (
        PrimaryKeyConstraint(
            "message_id", "user_id", "emoji", name="chat_message_reactions_pkey"
        ),
    )

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    emoji: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # SET NULL: если автор удалён, сообщение остаётся, в DTO author_user_id=null,
    # фронт показывает «Бывший сотрудник».
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Корень треда (Этап 4). По §6 плана треды глубиной 1 — ответ на ответ всё
    # равно ссылается на корневое сообщение, поэтому отдельный thread_root_id
    # не вводим. NULL — это «верхне-уровневое» сообщение в основной ленте.
    parent_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    text_: Mapped[str] = mapped_column("text", Text(), nullable=False)
    # Заполняется при редактировании (Этап 2). Для UI-метки «изменено».
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Soft-delete (Этап 2). На Этапе 1 всегда NULL — но колонку заводим
    # сразу, чтобы не делать ALTER в миграции 0013.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # Полнотекстовый индекс (Этап 5). Пересчитывается триггером БД при
    # INSERT/UPDATE OF text — Python в этом не участвует, поле read-only.
    tsv: Mapped[str | None] = mapped_column(TSVECTOR(), nullable=True)
