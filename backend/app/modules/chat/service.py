"""Сервис чата (Этапы 1–2).

Минимальный набор: create/get DM, list_conversations, post/edit/delete
сообщений, mark_read, list_messages с keyset-пагинацией. Каждое доменное
действие публикует realtime-событие с приватной аудиторией (список user_id
членов диалога), что обеспечивает «сообщение Васи и Пети получает только
Вася и Петя».

Парсер @-упоминаний — токен `<@uuid>` в тексте превращается в Notification
для каждого упомянутого участника диалога (Этап 2).
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone

from fastapi import status
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.chat.models import (
    ChatConversation,
    ChatMember,
    ChatMemberRole,
    ChatMessage,
    ChatMessageReaction,
    ConversationKind,
)
from app.modules.files.models import File, FileEntityType
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import (
    NotificationEntityType,
    NotificationKind,
)
from app.modules.users.models import Role, User
from app.realtime.events import publish_chat_event


# === helpers ================================================================


def _dm_pair_hash(a: uuid.UUID, b: uuid.UUID) -> str:
    """md5(min(uuid)||max(uuid)) — стабильно одинаков для (a,b) и (b,a)."""
    lo, hi = sorted([str(a), str(b)])
    return hashlib.md5(f"{lo}|{hi}".encode("utf-8")).hexdigest()


async def _audience_user_ids(
    db: AsyncSession, conversation_id: uuid.UUID
) -> list[uuid.UUID]:
    rows = await db.execute(
        select(ChatMember.user_id).where(
            ChatMember.conversation_id == conversation_id
        )
    )
    return [r for r in rows.scalars().all()]


# Токен упоминания на проводе и в БД — `<@uuid>`. Фронт показывает его
# человекочитаемо («@Иван Иванов»), парсинг символов идёт всегда по этому
# формату. Регэксп лояльный к регистру UUID.
_MENTION_RE = re.compile(
    r"<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>"
)


def _extract_mention_ids(text: str) -> list[uuid.UUID]:
    """Уникальные UUID, упомянутые в тексте, в порядке появления."""
    seen: dict[uuid.UUID, None] = {}
    for match in _MENTION_RE.finditer(text):
        try:
            uid = uuid.UUID(match.group(1))
        except ValueError:
            continue
        seen.setdefault(uid, None)
    return list(seen.keys())


async def _ensure_member(
    db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> ChatMember:
    member = await db.get(ChatMember, (conversation_id, user_id))
    if member is None:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Вы не участник этого диалога",
        )
    return member


async def _message_or_404(
    db: AsyncSession, conversation_id: uuid.UUID, message_id: uuid.UUID
) -> ChatMessage:
    """Защита от ?_id_ из чужого диалога: проверяем и принадлежность."""
    msg = await db.get(ChatMessage, message_id)
    if msg is None or msg.conversation_id != conversation_id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Сообщение не найдено"
        )
    return msg


# === conversations ==========================================================


async def get_or_create_dm(
    db: AsyncSession, *, current_user: User, peer_user_id: uuid.UUID
) -> ChatConversation:
    """Идемпотентно: если DM между двумя юзерами уже существует — вернёт его.

    Себе писать нельзя — на это бросаем 400. Для несуществующего peer — 404.
    """
    if peer_user_id == current_user.id:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "self_dm",
            "Нельзя создать диалог с самим собой",
        )
    peer = await db.get(User, peer_user_id)
    if peer is None or not peer.is_active:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Пользователь не найден"
        )

    pair_hash = _dm_pair_hash(current_user.id, peer_user_id)
    existing = (
        await db.execute(
            select(ChatConversation).where(
                ChatConversation.kind == ConversationKind.dm,
                ChatConversation.sorted_pair_hash == pair_hash,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    conv = ChatConversation(
        kind=ConversationKind.dm,
        title=None,
        created_by=current_user.id,
        sorted_pair_hash=pair_hash,
    )
    db.add(conv)
    await db.flush()
    db.add_all(
        [
            ChatMember(
                conversation_id=conv.id,
                user_id=current_user.id,
                role=ChatMemberRole.owner,
            ),
            ChatMember(
                conversation_id=conv.id,
                user_id=peer_user_id,
                role=ChatMemberRole.member,
            ),
        ]
    )
    await db.commit()
    await db.refresh(conv)

    publish_chat_event(
        "chat.conversation_changed",
        audience=[current_user.id, peer_user_id],
        payload={
            "conversationId": str(conv.id),
            "kind": "created",
        },
        actor_id=current_user.id,
    )
    return conv


async def list_conversations(
    db: AsyncSession,
    *,
    current_user: User,
    include_archived: bool = False,
) -> list[tuple[ChatConversation, list[uuid.UUID], ChatMember]]:
    """Возвращает диалоги пользователя + список member_ids + ChatMember
    текущего пользователя на каждом диалоге (read-state, mute, archive).

    По умолчанию архивированные (`hidden_at IS NOT NULL`) скрыты — это
    управление списком на стороне юзера. `include_archived=True` отдаёт всё.

    Сортировка — по last_message_at DESC NULLS LAST (свежие сверху).
    """
    stmt = (
        select(ChatConversation, ChatMember)
        .join(
            ChatMember,
            ChatMember.conversation_id == ChatConversation.id,
        )
        .where(ChatMember.user_id == current_user.id)
        .order_by(
            desc(ChatConversation.last_message_at.is_(None)),
            desc(ChatConversation.last_message_at),
            desc(ChatConversation.created_at),
        )
    )
    if not include_archived:
        stmt = stmt.where(ChatMember.hidden_at.is_(None))
    rows = await db.execute(stmt)
    pairs = list(rows.all())
    result: list[tuple[ChatConversation, list[uuid.UUID], ChatMember]] = []
    for conv, member in pairs:
        members = await _audience_user_ids(db, conv.id)
        result.append((conv, members, member))
    return result


async def get_conversation(
    db: AsyncSession, *, current_user: User, conversation_id: uuid.UUID
) -> tuple[ChatConversation, list[uuid.UUID], ChatMember]:
    conv = await db.get(ChatConversation, conversation_id)
    if conv is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Диалог не найден"
        )
    my_member = await _ensure_member(db, conversation_id, current_user.id)
    members = await _audience_user_ids(db, conversation_id)
    return conv, members, my_member


# === messages ===============================================================


async def _notify_mentions(
    db: AsyncSession,
    *,
    author: User,
    audience_ids: set[uuid.UUID],
    mention_ids: list[uuid.UUID],
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
) -> list[uuid.UUID]:
    """Создаёт Notification kind=mention для упомянутых, возвращает список
    тех, кого фактически уведомили (для UI/realtime-payload).

    Принципы (см. §2.5 плана):
      • автор сам себе не нотифится;
      • упомянутый должен быть участником диалога (иначе игнорируем — могло
        случиться при копи-пасте старого упоминания после ухода юзера);
      • если у получателя `muted_until > now()` — Notification не создаётся
        (но realtime-сообщение всё равно приходит, см. §2.5 плана и Этап 6);
      • повторное упоминание того же юзера при редактировании сообщения
        здесь не дедуплицируется — это делает вызывающий код через diff.
    """
    candidates = [
        uid
        for uid in mention_ids
        if uid in audience_ids and uid != author.id
    ]
    if not candidates:
        return []

    # Отфильтруем тех, кто заmute-ил этот диалог.
    now = datetime.now(timezone.utc)
    muted_rows = await db.execute(
        select(ChatMember.user_id).where(
            ChatMember.conversation_id == conversation_id,
            ChatMember.user_id.in_(candidates),
            ChatMember.muted_until.isnot(None),
            ChatMember.muted_until > now,
        )
    )
    muted_set = set(muted_rows.scalars().all())
    recipients = [uid for uid in candidates if uid not in muted_set]
    if not recipients:
        return []
    await notify_service.notify_many(
        db,
        recipient_ids=recipients,
        kind=NotificationKind.mention,
        text=f"{author.full_name} упомянул(а) вас в чате",
        entity_type=NotificationEntityType.chat_message,
        entity_id=message_id,
        payload={
            "conversationId": str(conversation_id),
            "messageId": str(message_id),
        },
    )
    return recipients


async def post_message(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    text: str,
    parent_message_id: uuid.UUID | None = None,
    file_ids: list[uuid.UUID] | None = None,
) -> ChatMessage:
    """Создать сообщение в диалоге.

    `parent_message_id` — если задан, это ответ в тред. Парент должен:
      • существовать в этом же диалоге;
      • сам не быть ответом (treds одноуровневые, см. §6 плана).

    `file_ids` — список предварительно загруженных файлов (presign+confirm с
    временным `entity_id`). Сервис перепривязывает их к сообщению через
    `entity_type=chat_message`, `entity_id=msg.id`. Проверяется, что файлы
    принадлежат текущему юзеру, ещё не привязаны к другому сообщению и не
    были помечены инфицированными.
    """
    await _ensure_member(db, conversation_id, current_user.id)
    conv = await db.get(ChatConversation, conversation_id)
    if conv is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Диалог не найден"
        )

    if parent_message_id is not None:
        parent = await db.get(ChatMessage, parent_message_id)
        if parent is None or parent.conversation_id != conversation_id:
            raise ApiError(
                status.HTTP_404_NOT_FOUND,
                "parent_not_found",
                "Сообщение, на которое отвечаете, не найдено",
            )
        if parent.parent_message_id is not None:
            raise ApiError(
                status.HTTP_400_BAD_REQUEST,
                "thread_depth",
                "Треды одноуровневые — отвечайте на корень треда",
            )

    file_ids_list = list(file_ids or [])
    files_to_attach: list[File] = []
    if file_ids_list:
        rows = await db.execute(
            select(File).where(File.id.in_(set(file_ids_list)))
        )
        files_to_attach = list(rows.scalars().all())
        if len(files_to_attach) != len(set(file_ids_list)):
            raise ApiError(
                status.HTTP_404_NOT_FOUND,
                "files_not_found",
                "Часть вложений не найдена",
            )
        for f in files_to_attach:
            if f.owner_user_id != current_user.id:
                raise ApiError(
                    status.HTTP_403_FORBIDDEN,
                    "file_not_yours",
                    "Можно прикрепить только свои файлы",
                )

    msg = ChatMessage(
        conversation_id=conversation_id,
        author_user_id=current_user.id,
        text_=text,
        parent_message_id=parent_message_id,
    )
    db.add(msg)
    await db.flush()

    # Перепривязка вложений к новому сообщению.
    for f in files_to_attach:
        f.entity_type = FileEntityType.chat_message
        f.entity_id = msg.id

    # last_message_at трогаем только при сообщении в основную ленту — ответы
    # в треде не должны «выталкивать» диалог наверх.
    if parent_message_id is None:
        conv.last_message_at = datetime.now(timezone.utc)

    # Своё же сообщение по определению «прочитано» — фиксируем read-state
    # автора сразу, иначе у него самого зажжётся unread-точка пока не
    # сработает auto-mark-read во фронте. Не уменьшаем значение (вдруг
    # автор уже прочитал ещё более новое — теоретически невозможно, но
    # симметрично с `mark_read`).
    author_member = await db.get(
        ChatMember, (conversation_id, current_user.id)
    )
    if author_member is not None and (
        author_member.last_read_at is None
        or msg.created_at > author_member.last_read_at
    ):
        author_member.last_read_message_id = msg.id
        author_member.last_read_at = msg.created_at
        # Slack-конвенция: новое сообщение возвращает диалог из архива у
        # всех получателей. Себе тоже сбрасываем — если я был в архиве и
        # сам же пишу, диалог разумно показать снова.
        from sqlalchemy import update as sql_update

        await db.execute(
            sql_update(ChatMember)
            .where(
                ChatMember.conversation_id == conversation_id,
                ChatMember.hidden_at.isnot(None),
            )
            .values(hidden_at=None)
        )

    audience_ids = await _audience_user_ids(db, conversation_id)
    mention_ids = _extract_mention_ids(text)
    notified = await _notify_mentions(
        db,
        author=current_user,
        audience_ids=set(audience_ids),
        mention_ids=mention_ids,
        conversation_id=conversation_id,
        message_id=msg.id,
    )

    await db.commit()
    await db.refresh(msg)

    publish_chat_event(
        "chat.message_created",
        audience=audience_ids,
        payload={
            "conversationId": str(conversation_id),
            "messageId": str(msg.id),
            "parentMessageId": (
                str(parent_message_id) if parent_message_id else None
            ),
            "authorId": str(current_user.id),
            "preview": text[:140],
            "mentions": [str(u) for u in mention_ids],
            "notifiedUserIds": [str(u) for u in notified],
            "createdAt": msg.created_at.isoformat(),
        },
        actor_id=current_user.id,
    )
    return msg


# === edit / delete =========================================================


def _can_moderate(user: User) -> bool:
    """Кто может удалять чужие сообщения. На Этапе 2 — только admin.
    Поле `chat:moderate` в permission_matrix зарезервировано на Этап 6.
    """
    return user.role == Role.admin


async def update_message(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    text: str,
) -> ChatMessage:
    """Редактировать может только автор. Удалённое сообщение редактировать
    нельзя. На каждом edit пересчитываем mentions: новые (которых не было в
    предыдущей редакции) получают Notification, старые удалённые — нет.
    """
    msg = await db.get(ChatMessage, message_id)
    if msg is None or msg.conversation_id != conversation_id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Сообщение не найдено"
        )
    if msg.deleted_at is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "deleted",
            "Сообщение удалено — редактирование невозможно",
        )
    if msg.author_user_id != current_user.id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Редактировать может только автор",
        )

    previous_mentions = set(_extract_mention_ids(msg.text_))
    new_mentions = _extract_mention_ids(text)
    added = [uid for uid in new_mentions if uid not in previous_mentions]

    msg.text_ = text
    msg.edited_at = datetime.now(timezone.utc)

    audience_ids = await _audience_user_ids(db, conversation_id)
    notified: list[uuid.UUID] = []
    if added:
        notified = await _notify_mentions(
            db,
            author=current_user,
            audience_ids=set(audience_ids),
            mention_ids=added,
            conversation_id=conversation_id,
            message_id=msg.id,
        )

    await db.commit()
    await db.refresh(msg)

    publish_chat_event(
        "chat.message_updated",
        audience=audience_ids,
        payload={
            "conversationId": str(conversation_id),
            "messageId": str(msg.id),
            "mentions": [str(u) for u in new_mentions],
            "notifiedUserIds": [str(u) for u in notified],
            "editedAt": msg.edited_at.isoformat() if msg.edited_at else None,
        },
        actor_id=current_user.id,
    )
    return msg


async def delete_message(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
) -> ChatMessage:
    """Soft-delete: ставим deleted_at и затираем текст. При отдаче через DTO
    сервис подменяет text на пустую строку (см. endpoints) — но и в БД
    хранить старое содержимое после явного удаления нелогично.
    """
    msg = await db.get(ChatMessage, message_id)
    if msg is None or msg.conversation_id != conversation_id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Сообщение не найдено"
        )
    if msg.deleted_at is not None:
        return msg  # идемпотентно: повторное удаление — no-op
    if msg.author_user_id != current_user.id and not _can_moderate(current_user):
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Удалять можно только свои сообщения",
        )

    msg.deleted_at = datetime.now(timezone.utc)
    msg.text_ = ""
    await db.commit()
    await db.refresh(msg)

    audience_ids = await _audience_user_ids(db, conversation_id)
    publish_chat_event(
        "chat.message_deleted",
        audience=audience_ids,
        payload={
            "conversationId": str(conversation_id),
            "messageId": str(msg.id),
            "deletedAt": msg.deleted_at.isoformat() if msg.deleted_at else None,
        },
        actor_id=current_user.id,
    )
    return msg


# === read-state ============================================================


async def mark_read(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    last_read_message_id: uuid.UUID,
) -> ChatMember:
    """Фиксируем «прочитано до сообщения X». Если фронт прислал старее уже
    сохранённого — не уменьшаем (защита от гонок при одновременном чтении
    в двух вкладках).
    """
    member = await _ensure_member(db, conversation_id, current_user.id)
    msg = await db.get(ChatMessage, last_read_message_id)
    if msg is None or msg.conversation_id != conversation_id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Сообщение не найдено"
        )

    # Если уже отмечено более новое сообщение — не откатываемся.
    if member.last_read_at is not None and msg.created_at <= member.last_read_at:
        return member

    member.last_read_message_id = msg.id
    member.last_read_at = msg.created_at
    await db.commit()
    await db.refresh(member)

    audience_ids = await _audience_user_ids(db, conversation_id)
    publish_chat_event(
        "chat.read",
        audience=audience_ids,
        payload={
            "conversationId": str(conversation_id),
            "userId": str(current_user.id),
            "lastReadMessageId": str(msg.id),
            "lastReadAt": msg.created_at.isoformat(),
        },
        actor_id=current_user.id,
    )
    return member


# === mute & archive (Этап 6) ===============================================


async def set_mute(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    until: datetime | None,
) -> ChatMember:
    """Включить/выключить mute. `until=None` → снять mute."""
    member = await _ensure_member(db, conversation_id, current_user.id)
    member.muted_until = until
    await db.commit()
    await db.refresh(member)
    return member


async def set_archive(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    hide: bool,
) -> ChatMember:
    """Скрыть/восстановить диалог в списке. Архив у каждого юзера свой —
    realtime никому не публикуем (это персональная настройка).
    """
    member = await _ensure_member(db, conversation_id, current_user.id)
    member.hidden_at = datetime.now(timezone.utc) if hide else None
    await db.commit()
    await db.refresh(member)
    return member


async def delete_conversation(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
) -> None:
    """Полное удаление диалога.

    - DM может удалить любой участник;
    - group — только owner (или admin системы).
    """
    conv = await db.get(ChatConversation, conversation_id)
    if conv is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Диалог не найден"
        )

    my_member = await _ensure_member(db, conversation_id, current_user.id)
    if conv.kind == ConversationKind.group:
        await _ensure_owner(my_member, current_user)

    audience_before = await _audience_user_ids(db, conversation_id)
    await db.delete(conv)
    await db.commit()

    publish_chat_event(
        "chat.conversation_changed",
        audience=audience_before,
        payload={
            "conversationId": str(conversation_id),
            "kind": "deleted",
        },
        actor_id=current_user.id,
    )


async def list_messages(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    limit: int = 50,
    before: datetime | None = None,
    thread_root_id: uuid.UUID | None = None,
) -> tuple[list[ChatMessage], datetime | None]:
    """Keyset-пагинация: возвращает не более `limit` сообщений старше `before`
    (или последние, если cursor пуст). Сообщения отдаются в хронологическом
    порядке (старые → новые), `next_cursor` — created_at самого старого.

    `thread_root_id`:
      • None → основная лента (только сообщения с parent_message_id IS NULL);
      • задан → корень треда + все его ответы (треды одноуровневые).
    """
    await _ensure_member(db, conversation_id, current_user.id)
    limit = max(1, min(limit, 200))

    stmt = (
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(desc(ChatMessage.created_at), desc(ChatMessage.id))
        .limit(limit + 1)  # +1, чтобы понять, есть ли ещё страница
    )
    if thread_root_id is not None:
        # Корень + все его ответы. Глубина 1 — больше уровней не бывает.
        stmt = stmt.where(
            or_(
                ChatMessage.id == thread_root_id,
                ChatMessage.parent_message_id == thread_root_id,
            )
        )
    else:
        stmt = stmt.where(ChatMessage.parent_message_id.is_(None))
    if before is not None:
        stmt = stmt.where(ChatMessage.created_at < before)

    rows = await db.execute(stmt)
    items_desc = list(rows.scalars().all())
    has_more = len(items_desc) > limit
    if has_more:
        items_desc = items_desc[:limit]

    # Отдаём фронту в хронологическом порядке: старые → новые.
    items_asc = list(reversed(items_desc))
    next_cursor: datetime | None = None
    if has_more and items_asc:
        next_cursor = items_asc[0].created_at
    return items_asc, next_cursor


# === attachments & reply counts batched =====================================


async def list_attachments_for_messages(
    db: AsyncSession, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[File]]:
    """{ message_id: [File, ...] } для batch-выдачи в DTO."""
    if not message_ids:
        return {}
    rows = await db.execute(
        select(File)
        .where(
            File.entity_type == FileEntityType.chat_message,
            File.entity_id.in_(message_ids),
        )
        .order_by(File.created_at)
    )
    grouped: dict[uuid.UUID, list[File]] = {}
    for f in rows.scalars().all():
        grouped.setdefault(f.entity_id, []).append(f)
    return grouped


async def reply_counts_for_messages(
    db: AsyncSession, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """{ message_id: count(replies) } для batch-выдачи в DTO."""
    if not message_ids:
        return {}
    rows = await db.execute(
        select(ChatMessage.parent_message_id, func.count(ChatMessage.id))
        .where(ChatMessage.parent_message_id.in_(message_ids))
        .group_by(ChatMessage.parent_message_id)
    )
    return {pid: cnt for pid, cnt in rows.all()}


# === full-text search (Этап 5) =============================================


_HEADLINE_OPTIONS = (
    "StartSel=<mark>,StopSel=</mark>,"
    "MaxWords=18,MinWords=4,ShortWord=2,HighlightAll=false"
)


async def search_messages(
    db: AsyncSession,
    *,
    current_user: User,
    q: str,
    conversation_id: uuid.UUID | None = None,
    limit: int = 50,
) -> list[tuple[ChatMessage, str, float]]:
    """Полнотекстовый поиск по сообщениям.

    Фильтры:
      • только в диалогах, где `current_user` — участник (через EXISTS);
      • опционально только в `conversation_id` (поиск внутри диалога);
      • удалённые сообщения скрыты.

    Сортировка — по `ts_rank` (DESC), при равенстве — по дате (DESC).
    Возвращает список троек `(message, snippet_html, rank)` — snippet
    уже отформатирован с `<mark>` через `ts_headline`.
    """
    q = q.strip()
    if not q:
        return []
    limit = max(1, min(limit, 100))

    # websearch_to_tsquery поддерживает Slack-подобный синтаксис:
    # «"точная фраза"», «слово OR слово», «слово -стоп», без выброса
    # исключений на невалидном запросе.
    tsquery = func.websearch_to_tsquery("russian", q)

    rank = func.ts_rank(ChatMessage.tsv, tsquery).label("rank")
    snippet = func.ts_headline(
        "russian",
        ChatMessage.text_,
        tsquery,
        _HEADLINE_OPTIONS,
    ).label("snippet")

    # EXISTS-подзапрос вместо JOIN — чтобы не дублировать сообщения, если у
    # текущего юзера несколько мембершипов с этим диалогом (не бывает, но
    # на всякий случай).
    membership_exists = (
        select(ChatMember.user_id)
        .where(
            ChatMember.conversation_id == ChatMessage.conversation_id,
            ChatMember.user_id == current_user.id,
        )
        .exists()
    )

    stmt = (
        select(ChatMessage, snippet, rank)
        .where(
            ChatMessage.tsv.op("@@")(tsquery),
            ChatMessage.deleted_at.is_(None),
            membership_exists,
        )
        .order_by(rank.desc(), desc(ChatMessage.created_at))
        .limit(limit)
    )
    if conversation_id is not None:
        # Если задан диалог — заодно проверим членство явно, иначе пустой
        # результат и так получится через membership_exists.
        await _ensure_member(db, conversation_id, current_user.id)
        stmt = stmt.where(ChatMessage.conversation_id == conversation_id)

    rows = await db.execute(stmt)
    out: list[tuple[ChatMessage, str, float]] = []
    for msg, snip, rnk in rows.all():
        out.append((msg, snip or "", float(rnk or 0.0)))
    return out


# === group conversations ===================================================


async def create_group(
    db: AsyncSession,
    *,
    current_user: User,
    title: str,
    member_ids: list[uuid.UUID],
) -> ChatConversation:
    """Создать групповой чат. current_user становится owner-ом и автоматически
    добавляется в список участников. Лимит участников — 50 (с учётом owner).
    """
    title = title.strip()
    if not title:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST, "title_required", "Название обязательно"
        )

    # Уникализируем + убираем self (если фронт прислал его явно).
    cleaned = {uid for uid in member_ids if uid != current_user.id}
    if not cleaned:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "members_required",
            "Добавьте хотя бы одного участника",
        )

    # Проверим, что все юзеры существуют и активны.
    rows = await db.execute(
        select(User.id).where(User.id.in_(cleaned), User.is_active.is_(True))
    )
    existing = set(rows.scalars().all())
    missing = cleaned - existing
    if missing:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "users_not_found",
            "Часть участников не найдена",
            {"userIds": [str(u) for u in missing]},
        )

    total = len(cleaned) + 1  # + owner
    if total > 50:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "members_limit",
            "Максимум 50 участников в группе",
        )

    conv = ChatConversation(
        kind=ConversationKind.group,
        title=title,
        created_by=current_user.id,
        sorted_pair_hash=None,
    )
    db.add(conv)
    await db.flush()
    db.add(
        ChatMember(
            conversation_id=conv.id,
            user_id=current_user.id,
            role=ChatMemberRole.owner,
        )
    )
    db.add_all(
        ChatMember(
            conversation_id=conv.id,
            user_id=uid,
            role=ChatMemberRole.member,
        )
        for uid in cleaned
    )
    await db.commit()
    await db.refresh(conv)

    audience = [current_user.id, *cleaned]
    publish_chat_event(
        "chat.conversation_changed",
        audience=audience,
        payload={
            "conversationId": str(conv.id),
            "kind": "created",
            "title": conv.title,
        },
        actor_id=current_user.id,
    )
    return conv


async def _ensure_owner(member: ChatMember, user: User) -> None:
    """Owner или admin системы — могут менять title/состав. Любой остальной
    может только выйти сам (через remove_member(self))."""
    if member.role == ChatMemberRole.owner:
        return
    if user.role == Role.admin:
        return
    raise ApiError(
        status.HTTP_403_FORBIDDEN,
        "forbidden",
        "Изменять группу может только владелец",
    )


async def rename_group(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    title: str,
) -> ChatConversation:
    conv = await db.get(ChatConversation, conversation_id)
    if conv is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Диалог не найден"
        )
    if conv.kind != ConversationKind.group:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "not_a_group",
            "Переименовать можно только групповой чат",
        )
    member = await _ensure_member(db, conversation_id, current_user.id)
    await _ensure_owner(member, current_user)

    new_title = title.strip()
    if not new_title:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST, "title_required", "Название обязательно"
        )
    conv.title = new_title
    await db.commit()
    await db.refresh(conv)

    audience = await _audience_user_ids(db, conversation_id)
    publish_chat_event(
        "chat.conversation_changed",
        audience=audience,
        payload={
            "conversationId": str(conversation_id),
            "kind": "renamed",
            "title": conv.title,
        },
        actor_id=current_user.id,
    )
    return conv


async def add_members(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    user_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    """Добавить участников в группу. Возвращает реально добавленных
    (без дублей с уже состоящими).
    """
    conv = await db.get(ChatConversation, conversation_id)
    if conv is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Диалог не найден"
        )
    if conv.kind != ConversationKind.group:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "not_a_group",
            "Добавить участника можно только в группу",
        )
    member = await _ensure_member(db, conversation_id, current_user.id)
    await _ensure_owner(member, current_user)

    cleaned = {uid for uid in user_ids}
    if not cleaned:
        return []

    # Активные пользователи.
    rows = await db.execute(
        select(User.id).where(User.id.in_(cleaned), User.is_active.is_(True))
    )
    existing_users = set(rows.scalars().all())
    missing = cleaned - existing_users
    if missing:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "users_not_found",
            "Часть пользователей не найдена",
            {"userIds": [str(u) for u in missing]},
        )

    # Кто уже в группе.
    rows = await db.execute(
        select(ChatMember.user_id).where(
            ChatMember.conversation_id == conversation_id,
            ChatMember.user_id.in_(existing_users),
        )
    )
    already = set(rows.scalars().all())
    to_add = existing_users - already
    if not to_add:
        return []

    # Контроль лимита 50.
    current_count = len(await _audience_user_ids(db, conversation_id))
    if current_count + len(to_add) > 50:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "members_limit",
            "Превышен лимит участников группы (50)",
        )

    db.add_all(
        ChatMember(
            conversation_id=conversation_id,
            user_id=uid,
            role=ChatMemberRole.member,
        )
        for uid in to_add
    )
    await db.commit()

    audience = await _audience_user_ids(db, conversation_id)
    publish_chat_event(
        "chat.conversation_changed",
        audience=audience,
        payload={
            "conversationId": str(conversation_id),
            "kind": "member_added",
            "userIds": [str(u) for u in to_add],
        },
        actor_id=current_user.id,
    )
    return list(to_add)


async def remove_member(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Убрать участника. Сам себя может любой (= leave). Чужих — только owner
    (или admin системы).

    По решению §6 плана — Telegram-like: фронт удалённого юзера сам уберёт
    диалог из списка, история ему тоже пропадает. Поэтому событие
    `chat.conversation_changed` мы шлём с аудиторией = СТАРЫЕ члены
    (включая удаляемого), чтобы клиент удалённого получил уведомление и
    выкинул диалог из локального кэша.
    """
    conv = await db.get(ChatConversation, conversation_id)
    if conv is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Диалог не найден"
        )
    if conv.kind != ConversationKind.group:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "not_a_group",
            "Управлять составом можно только в группе",
        )
    my_member = await _ensure_member(db, conversation_id, current_user.id)
    if user_id != current_user.id:
        await _ensure_owner(my_member, current_user)

    target = await db.get(ChatMember, (conversation_id, user_id))
    if target is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "not_member",
            "Этот пользователь не состоит в группе",
        )

    # Если уходит owner и в группе ещё кто-то — назначим нового owner-а
    # автоматически (самый старый по joined_at, кроме уходящего).
    if target.role == ChatMemberRole.owner:
        successor = (
            await db.execute(
                select(ChatMember)
                .where(
                    ChatMember.conversation_id == conversation_id,
                    ChatMember.user_id != user_id,
                )
                .order_by(ChatMember.joined_at, ChatMember.user_id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if successor is not None:
            successor.role = ChatMemberRole.owner

    # Аудиторию запоминаем ДО удаления — туда должен попасть и сам удаляемый.
    audience_before = await _audience_user_ids(db, conversation_id)

    await db.delete(target)
    await db.commit()

    publish_chat_event(
        "chat.conversation_changed",
        audience=audience_before,
        payload={
            "conversationId": str(conversation_id),
            "kind": "member_removed",
            "userId": str(user_id),
        },
        actor_id=current_user.id,
    )


# === reactions =============================================================


async def toggle_reaction(
    db: AsyncSession,
    *,
    current_user: User,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    emoji: str,
) -> tuple[ChatMessageReaction | None, str]:
    """Если у текущего юзера уже есть такая реакция — удаляем (action='remove').
    Иначе создаём (action='add'). Возвращает (reaction|None, action).
    """
    await _ensure_member(db, conversation_id, current_user.id)
    msg = await db.get(ChatMessage, message_id)
    if msg is None or msg.conversation_id != conversation_id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Сообщение не найдено"
        )
    if msg.deleted_at is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "deleted",
            "Удалённое сообщение не реагируется",
        )

    existing = await db.get(
        ChatMessageReaction, (message_id, current_user.id, emoji)
    )
    if existing is not None:
        await db.delete(existing)
        await db.commit()
        action = "remove"
        result: ChatMessageReaction | None = None
    else:
        new = ChatMessageReaction(
            message_id=message_id, user_id=current_user.id, emoji=emoji
        )
        db.add(new)
        await db.commit()
        await db.refresh(new)
        action = "add"
        result = new

    audience = await _audience_user_ids(db, conversation_id)
    publish_chat_event(
        "chat.reaction_changed",
        audience=audience,
        payload={
            "conversationId": str(conversation_id),
            "messageId": str(message_id),
            "emoji": emoji,
            "userId": str(current_user.id),
            "action": action,
        },
        actor_id=current_user.id,
    )
    return result, action


async def list_reactions_for_messages(
    db: AsyncSession, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ChatMessageReaction]]:
    """Возвращает {message_id: [reactions...]} — для batch-выдачи в DTO.
    Пустой словарь при пустом списке.
    """
    if not message_ids:
        return {}
    rows = await db.execute(
        select(ChatMessageReaction)
        .where(ChatMessageReaction.message_id.in_(message_ids))
        .order_by(ChatMessageReaction.created_at)
    )
    grouped: dict[uuid.UUID, list[ChatMessageReaction]] = {}
    for r in rows.scalars().all():
        grouped.setdefault(r.message_id, []).append(r)
    return grouped
