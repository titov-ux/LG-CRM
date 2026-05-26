"""DTO модуля чата (camelCase в JSON, snake_case в Python — см. CamelModel)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.chat.models import ChatMemberRole, ConversationKind
from app.modules.files.schemas import FileResponse


class ConversationMember(CamelModel):
    user_id: uuid.UUID | None
    role: ChatMemberRole
    joined_at: datetime
    # Read-state текущего пользователя (Этап 2). У других юзеров мы это
    # значение не отдаём — приватность чтения.
    last_read_message_id: uuid.UUID | None = None
    last_read_at: datetime | None = None


class ConversationResponse(CamelModel):
    id: uuid.UUID
    kind: ConversationKind
    title: str | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    last_message_at: datetime | None = None
    member_ids: list[uuid.UUID] = Field(default_factory=list)
    # Read-state именно текущего пользователя — фронт считает unread,
    # сравнивая `last_message_at > my_last_read_at`.
    my_last_read_message_id: uuid.UUID | None = None
    my_last_read_at: datetime | None = None
    # Этап 6: персональные mute/archive текущего юзера (другим не отдаём).
    my_muted_until: datetime | None = None
    my_hidden_at: datetime | None = None


class CreateDmRequest(CamelModel):
    peer_user_id: uuid.UUID


class CreateGroupRequest(CamelModel):
    title: str = Field(min_length=1, max_length=255)
    # Лимит участников: soft 50 (решение по §6 плана; см. crm-lg-chat-stage1).
    # 1..50 — себя как owner-а сервис добавит автоматически.
    member_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class RenameGroupRequest(CamelModel):
    title: str = Field(min_length=1, max_length=255)


class AddMembersRequest(CamelModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class ReactionGroup(CamelModel):
    """Агрегированная реакция на сообщение — `emoji`, кто и сколько."""

    emoji: str
    count: int
    user_ids: list[uuid.UUID]
    mine_reacted: bool = False


class MessageResponse(CamelModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    author_user_id: uuid.UUID | None = None
    # NULL — корневое сообщение основной ленты; задано — ответ в треде, ссылка
    # на корень (треды глубиной 1, см. §6 плана).
    parent_message_id: uuid.UUID | None = None
    text: str
    mentions: list[uuid.UUID] = Field(default_factory=list)
    reactions: list[ReactionGroup] = Field(default_factory=list)
    # Этап 4: вложения и счётчик ответов в треде. У ответов reply_count
    # всегда 0 (треды одноуровневые). У удалённых reply_count тоже отдаём
    # фактический — фронт может показать «N ответов» под плейсхолдером.
    attachments: list[FileResponse] = Field(default_factory=list)
    reply_count: int = 0
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    created_at: datetime


class CreateMessageRequest(CamelModel):
    text: str = Field(min_length=1, max_length=10000)
    # Если задано — это ответ в тред. Должно быть корневым сообщением того же
    # диалога (треды глубиной 1, см. §6 плана).
    parent_message_id: uuid.UUID | None = None
    # ID файлов, уже загруженных через /files/presign + /files/confirm с
    # entity_type=chat_message и временным entity_id (например, заглушкой —
    # сервис пересвяжет к id сообщения после его создания).
    file_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)


class UpdateMessageRequest(CamelModel):
    text: str = Field(min_length=1, max_length=10000)


class MarkReadRequest(CamelModel):
    last_read_message_id: uuid.UUID


class ToggleReactionRequest(CamelModel):
    emoji: str = Field(min_length=1, max_length=64)


class MuteRequest(CamelModel):
    """`until=None` → снять mute, иначе — глушить уведомления до указанного времени."""

    until: datetime | None = None


# === search (Этап 5) ========================================================


class ChatSearchHit(CamelModel):
    """Один результат поиска: сообщение + предсчитанный snippet с <mark>."""

    conversation_id: uuid.UUID
    message: MessageResponse
    # ts_headline выдаёт HTML со вставками <mark>...</mark> вокруг
    # совпадений. Длина и количество слов настраиваются в сервисе.
    snippet: str
    # ts_rank — для отладки/сортировки на клиенте. Не критично.
    rank: float = 0.0


class ChatSearchResponse(CamelModel):
    query: str
    items: list[ChatSearchHit] = Field(default_factory=list)


class MessagesPage(CamelModel):
    """Keyset-страница: items в обратном порядке (новые в конце), `nextCursor`
    указывает на created_at сообщения, от которого продолжать листать вверх.
    """

    items: list[MessageResponse]
    next_cursor: str | None = None
