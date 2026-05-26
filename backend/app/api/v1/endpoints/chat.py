"""Эндпоинты /chat — внутренний чат (Этапы 1–3).

Покрывает DM и группы (членство, переименование, состав, выход), сообщения
с keyset-пагинацией, реакции эмодзи. Каждый мутирующий ответ публикует
realtime-событие с приватной audience — фильтрация в WS рассылке делается
на стороне `_pump_events` (см. endpoints/realtime.py).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.chat import service
from app.modules.chat.models import (
    ChatConversation,
    ChatMember,
    ChatMessage,
    ChatMessageReaction,
)
from app.modules.chat.schemas import (
    AddMembersRequest,
    ChatSearchHit,
    ChatSearchResponse,
    ConversationResponse,
    CreateDmRequest,
    CreateGroupRequest,
    CreateMessageRequest,
    MarkReadRequest,
    MessageResponse,
    MessagesPage,
    MuteRequest,
    ReactionGroup,
    RenameGroupRequest,
    ToggleReactionRequest,
    UpdateMessageRequest,
)
from app.modules.files.models import File
from app.modules.files.schemas import FileResponse
from app.modules.users.models import User

router = APIRouter(prefix="/chat", tags=["chat"])


def _conv_dto(
    c: ChatConversation,
    member_ids: list[uuid.UUID],
    my_member: ChatMember | None = None,
) -> ConversationResponse:
    return ConversationResponse(
        id=c.id,
        kind=c.kind,
        title=c.title,
        created_by=c.created_by,
        created_at=c.created_at,
        last_message_at=c.last_message_at,
        member_ids=member_ids,
        my_last_read_message_id=(
            my_member.last_read_message_id if my_member else None
        ),
        my_last_read_at=my_member.last_read_at if my_member else None,
        my_muted_until=my_member.muted_until if my_member else None,
        my_hidden_at=my_member.hidden_at if my_member else None,
    )


def _group_reactions(
    reactions: list[ChatMessageReaction], me_id: uuid.UUID
) -> list[ReactionGroup]:
    """Сворачиваем плоский список реакций в группы по эмодзи."""
    by_emoji: dict[str, list[uuid.UUID]] = {}
    for r in reactions:
        by_emoji.setdefault(r.emoji, []).append(r.user_id)
    out: list[ReactionGroup] = []
    for emoji, uids in by_emoji.items():
        out.append(
            ReactionGroup(
                emoji=emoji,
                count=len(uids),
                user_ids=uids,
                mine_reacted=me_id in uids,
            )
        )
    # Стабильный порядок: по убыванию count, потом по эмодзи.
    out.sort(key=lambda g: (-g.count, g.emoji))
    return out


def _msg_dto(
    m: ChatMessage,
    *,
    me_id: uuid.UUID,
    reactions: list[ChatMessageReaction] | None = None,
    attachments: list[File] | None = None,
    reply_count: int = 0,
) -> MessageResponse:
    """Удалённое сообщение отдаём без текста, mentions, реакций и вложений —
    фронт сам подменит на плейсхолдер «Сообщение удалено». reply_count
    отдаём всегда — даже у удалённого корня могут оставаться видимые
    ответы в треде.
    """
    is_deleted = m.deleted_at is not None
    return MessageResponse(
        id=m.id,
        conversation_id=m.conversation_id,
        author_user_id=m.author_user_id,
        parent_message_id=m.parent_message_id,
        text="" if is_deleted else m.text_,
        mentions=[] if is_deleted else service._extract_mention_ids(m.text_),
        reactions=(
            []
            if is_deleted
            else _group_reactions(reactions or [], me_id)
        ),
        attachments=(
            [] if is_deleted else [FileResponse.model_validate(f) for f in (attachments or [])]
        ),
        reply_count=reply_count,
        edited_at=m.edited_at,
        deleted_at=m.deleted_at,
        created_at=m.created_at,
    )


# === conversations =========================================================


@router.get(
    "/conversations",
    response_model=list[ConversationResponse],
    summary="Мои диалоги",
)
async def list_conversations(
    include_archived: bool = Query(default=False, alias="includeArchived"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationResponse]:
    rows = await service.list_conversations(
        db, current_user=user, include_archived=include_archived
    )
    return [_conv_dto(c, members, my) for c, members, my in rows]


@router.post(
    "/conversations/dm",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Открыть/создать DM с пользователем",
)
async def create_dm(
    payload: CreateDmRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    conv = await service.get_or_create_dm(
        db, current_user=user, peer_user_id=payload.peer_user_id
    )
    _, members, my = await service.get_conversation(
        db, current_user=user, conversation_id=conv.id
    )
    return _conv_dto(conv, members, my)


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationResponse,
    summary="Карточка диалога",
)
async def get_conversation(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    conv, members, my = await service.get_conversation(
        db, current_user=user, conversation_id=conversation_id
    )
    return _conv_dto(conv, members, my)


@router.post(
    "/conversations/{conversation_id}/read",
    response_model=OkResponse,
    summary="Отметить прочитанным до сообщения X",
)
async def mark_read(
    conversation_id: uuid.UUID,
    payload: MarkReadRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.mark_read(
        db,
        current_user=user,
        conversation_id=conversation_id,
        last_read_message_id=payload.last_read_message_id,
    )
    return OkResponse()


# === messages ==============================================================


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=MessagesPage,
    summary="История сообщений (keyset, листаем вверх)",
)
async def list_messages(
    conversation_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    before: datetime | None = Query(default=None),
    thread_root_id: uuid.UUID | None = Query(default=None, alias="threadRootId"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessagesPage:
    items, next_cursor = await service.list_messages(
        db,
        current_user=user,
        conversation_id=conversation_id,
        limit=limit,
        before=before,
        thread_root_id=thread_root_id,
    )
    live_ids = [m.id for m in items if m.deleted_at is None]
    reactions_map = await service.list_reactions_for_messages(db, live_ids)
    attachments_map = await service.list_attachments_for_messages(db, live_ids)
    # reply_count считаем для всех id страницы (включая удалённые корни —
    # у них могут быть ответы), но только когда мы в основной ленте.
    reply_target_ids = (
        [m.id for m in items] if thread_root_id is None else []
    )
    reply_counts = await service.reply_counts_for_messages(db, reply_target_ids)
    return MessagesPage(
        items=[
            _msg_dto(
                m,
                me_id=user.id,
                reactions=reactions_map.get(m.id, []),
                attachments=attachments_map.get(m.id, []),
                reply_count=reply_counts.get(m.id, 0),
            )
            for m in items
        ],
        next_cursor=next_cursor.isoformat() if next_cursor else None,
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Отправить сообщение",
)
async def post_message(
    conversation_id: uuid.UUID,
    payload: CreateMessageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    msg = await service.post_message(
        db,
        current_user=user,
        conversation_id=conversation_id,
        text=payload.text,
        parent_message_id=payload.parent_message_id,
        file_ids=payload.file_ids,
    )
    attachments = (
        await service.list_attachments_for_messages(db, [msg.id])
    ).get(msg.id, [])
    return _msg_dto(
        msg, me_id=user.id, reactions=[], attachments=attachments, reply_count=0
    )


@router.patch(
    "/conversations/{conversation_id}/messages/{message_id}",
    response_model=MessageResponse,
    summary="Редактировать своё сообщение",
)
async def update_message(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: UpdateMessageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    msg = await service.update_message(
        db,
        current_user=user,
        conversation_id=conversation_id,
        message_id=message_id,
        text=payload.text,
    )
    reactions = (
        await service.list_reactions_for_messages(db, [msg.id])
    ).get(msg.id, [])
    attachments = (
        await service.list_attachments_for_messages(db, [msg.id])
    ).get(msg.id, [])
    reply_count = (
        await service.reply_counts_for_messages(db, [msg.id])
    ).get(msg.id, 0)
    return _msg_dto(
        msg,
        me_id=user.id,
        reactions=reactions,
        attachments=attachments,
        reply_count=reply_count,
    )


@router.delete(
    "/conversations/{conversation_id}/messages/{message_id}",
    response_model=OkResponse,
    summary="Удалить своё сообщение (soft)",
)
async def delete_message(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_message(
        db,
        current_user=user,
        conversation_id=conversation_id,
        message_id=message_id,
    )
    return OkResponse()


# === groups ================================================================


@router.post(
    "/conversations/group",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать групповой чат",
)
async def create_group(
    payload: CreateGroupRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    conv = await service.create_group(
        db,
        current_user=user,
        title=payload.title,
        member_ids=payload.member_ids,
    )
    _, members, my = await service.get_conversation(
        db, current_user=user, conversation_id=conv.id
    )
    return _conv_dto(conv, members, my)


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ConversationResponse,
    summary="Переименовать групповой чат (owner)",
)
async def rename_group(
    conversation_id: uuid.UUID,
    payload: RenameGroupRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    conv = await service.rename_group(
        db,
        current_user=user,
        conversation_id=conversation_id,
        title=payload.title,
    )
    _, members, my = await service.get_conversation(
        db, current_user=user, conversation_id=conv.id
    )
    return _conv_dto(conv, members, my)


@router.post(
    "/conversations/{conversation_id}/members",
    response_model=ConversationResponse,
    summary="Добавить участников в группу (owner)",
)
async def add_members(
    conversation_id: uuid.UUID,
    payload: AddMembersRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    await service.add_members(
        db,
        current_user=user,
        conversation_id=conversation_id,
        user_ids=payload.user_ids,
    )
    conv, members, my = await service.get_conversation(
        db, current_user=user, conversation_id=conversation_id
    )
    return _conv_dto(conv, members, my)


@router.delete(
    "/conversations/{conversation_id}/members/{user_id}",
    response_model=OkResponse,
    summary="Убрать участника (owner; сам себя — любой)",
)
async def remove_member(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.remove_member(
        db,
        current_user=user,
        conversation_id=conversation_id,
        user_id=user_id,
    )
    return OkResponse()


@router.post(
    "/conversations/{conversation_id}/leave",
    response_model=OkResponse,
    summary="Выйти из группы (синоним DELETE /members/{me})",
)
async def leave_group(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.remove_member(
        db,
        current_user=user,
        conversation_id=conversation_id,
        user_id=user.id,
    )
    return OkResponse()


# === reactions =============================================================


@router.post(
    "/conversations/{conversation_id}/messages/{message_id}/reactions/toggle",
    response_model=MessageResponse,
    summary="Поставить / снять реакцию на сообщение",
)
async def toggle_reaction(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: ToggleReactionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    await service.toggle_reaction(
        db,
        current_user=user,
        conversation_id=conversation_id,
        message_id=message_id,
        emoji=payload.emoji,
    )
    # После toggle возвращаем актуальное сообщение с обновлённой группой реакций.
    msg = await service._message_or_404(db, conversation_id, message_id)  # type: ignore[attr-defined]
    reactions = (
        await service.list_reactions_for_messages(db, [msg.id])
    ).get(msg.id, [])
    attachments = (
        await service.list_attachments_for_messages(db, [msg.id])
    ).get(msg.id, [])
    reply_count = (
        await service.reply_counts_for_messages(db, [msg.id])
    ).get(msg.id, 0)
    return _msg_dto(
        msg,
        me_id=user.id,
        reactions=reactions,
        attachments=attachments,
        reply_count=reply_count,
    )


# === search ================================================================


@router.get(
    "/search",
    response_model=ChatSearchResponse,
    summary="Полнотекстовый поиск по доступным сообщениям",
)
async def search_messages(
    q: str = Query(min_length=1, max_length=512),
    conversation_id: uuid.UUID | None = Query(default=None, alias="conversationId"),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatSearchResponse:
    hits = await service.search_messages(
        db,
        current_user=user,
        q=q,
        conversation_id=conversation_id,
        limit=limit,
    )
    if not hits:
        return ChatSearchResponse(query=q, items=[])

    msg_ids = [m.id for (m, _s, _r) in hits]
    reactions_map = await service.list_reactions_for_messages(db, msg_ids)
    attachments_map = await service.list_attachments_for_messages(db, msg_ids)
    reply_counts = await service.reply_counts_for_messages(db, msg_ids)

    items = [
        ChatSearchHit(
            conversation_id=msg.conversation_id,
            message=_msg_dto(
                msg,
                me_id=user.id,
                reactions=reactions_map.get(msg.id, []),
                attachments=attachments_map.get(msg.id, []),
                reply_count=reply_counts.get(msg.id, 0),
            ),
            snippet=snippet,
            rank=rank,
        )
        for (msg, snippet, rank) in hits
    ]
    return ChatSearchResponse(query=q, items=items)


# === mute & archive (Этап 6) ===============================================


@router.post(
    "/conversations/{conversation_id}/mute",
    response_model=ConversationResponse,
    summary="Включить/выключить mute диалога (until=null → снять)",
)
async def mute_conversation(
    conversation_id: uuid.UUID,
    payload: MuteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    await service.set_mute(
        db,
        current_user=user,
        conversation_id=conversation_id,
        until=payload.until,
    )
    conv, members, my = await service.get_conversation(
        db, current_user=user, conversation_id=conversation_id
    )
    return _conv_dto(conv, members, my)


@router.post(
    "/conversations/{conversation_id}/archive",
    response_model=ConversationResponse,
    summary="Скрыть диалог из моего списка",
)
async def archive_conversation(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    await service.set_archive(
        db, current_user=user, conversation_id=conversation_id, hide=True
    )
    conv, members, my = await service.get_conversation(
        db, current_user=user, conversation_id=conversation_id
    )
    return _conv_dto(conv, members, my)


@router.post(
    "/conversations/{conversation_id}/unarchive",
    response_model=ConversationResponse,
    summary="Вернуть диалог в мой список",
)
async def unarchive_conversation(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    await service.set_archive(
        db, current_user=user, conversation_id=conversation_id, hide=False
    )
    conv, members, my = await service.get_conversation(
        db, current_user=user, conversation_id=conversation_id
    )
    return _conv_dto(conv, members, my)
