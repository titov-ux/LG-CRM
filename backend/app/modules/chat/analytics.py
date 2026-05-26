"""Метрики чата для /analytics (Этап 6 плана).

Считаем на лету без агрегирующей таблицы — объёмы маленькие, индексы по
`created_at` уже есть. Если когда-нибудь упрёмся в производительность,
сделаем материализованное представление.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.chat.models import (
    ChatConversation,
    ChatMember,
    ChatMessage,
    ConversationKind,
)


async def chat_stats(db: AsyncSession) -> dict[str, float | int]:
    """Возвращает простой dict с метриками; роутер маппит в ChatStats."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    seven_d_ago = now - timedelta(days=7)

    messages_today = (
        await db.execute(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.created_at >= today_start,
                ChatMessage.deleted_at.is_(None),
            )
        )
    ).scalar_one()

    messages_7d = (
        await db.execute(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.created_at >= seven_d_ago,
                ChatMessage.deleted_at.is_(None),
            )
        )
    ).scalar_one()

    active_users_7d = (
        await db.execute(
            select(func.count(func.distinct(ChatMessage.author_user_id))).where(
                ChatMessage.created_at >= seven_d_ago,
                ChatMessage.deleted_at.is_(None),
                ChatMessage.author_user_id.isnot(None),
            )
        )
    ).scalar_one()

    # Количества DM и групп.
    counts_row = (
        await db.execute(
            select(
                func.sum(
                    case(
                        (ChatConversation.kind == ConversationKind.dm, 1),
                        else_=0,
                    )
                ).label("dm_count"),
                func.sum(
                    case(
                        (ChatConversation.kind == ConversationKind.group, 1),
                        else_=0,
                    )
                ).label("group_count"),
            )
        )
    ).one()
    dm_count = int(counts_row.dm_count or 0)
    group_count = int(counts_row.group_count or 0)

    # Средний размер группы. Подзапрос: количество членов на каждую группу,
    # потом AVG.
    members_per_group_subq = (
        select(func.count(ChatMember.user_id).label("n"))
        .join(
            ChatConversation,
            ChatConversation.id == ChatMember.conversation_id,
        )
        .where(ChatConversation.kind == ConversationKind.group)
        .group_by(ChatMember.conversation_id)
        .subquery()
    )
    avg_group_size = (
        await db.execute(select(func.avg(members_per_group_subq.c.n)))
    ).scalar_one()

    return {
        "messagesToday": int(messages_today or 0),
        "messages7d": int(messages_7d or 0),
        "activeUsers7d": int(active_users_7d or 0),
        "dmCount": dm_count,
        "groupCount": group_count,
        "avgGroupSize": float(avg_group_size or 0.0),
    }
