"""Сервис notifications.

`notify(...)` создаёт запись синхронно — в той же транзакции, что и доменное
действие. На реальном продакшене над этим встанет `NotificationDispatcher`
(Celery), который дополнительно отправит email/Telegram (см. план §4 Этап 7).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.notifications.models import (
    Notification,
    NotificationEntityType,
    NotificationKind,
)


async def notify(
    db: AsyncSession,
    *,
    recipient_id: uuid.UUID,
    kind: NotificationKind,
    text: str,
    entity_type: NotificationEntityType | None = None,
    entity_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> Notification:
    n = Notification(
        user_id=recipient_id,
        kind=kind,
        text_=text,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload or {},
    )
    db.add(n)
    await db.flush()
    return n


async def notify_many(
    db: AsyncSession,
    *,
    recipient_ids: Iterable[uuid.UUID],
    kind: NotificationKind,
    text: str,
    entity_type: NotificationEntityType | None = None,
    entity_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> list[Notification]:
    out: list[Notification] = []
    for rid in {*recipient_ids}:  # дедупликация
        n = await notify(
            db,
            recipient_id=rid,
            kind=kind,
            text=text,
            entity_type=entity_type,
            entity_id=entity_id,
            payload=payload,
        )
        out.append(n)
    return out


async def list_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[Notification]:
    res = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(200)
    )
    return list(res.scalars().all())


async def mark_read(
    db: AsyncSession, user_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification:
    n = await db.get(Notification, notification_id)
    if n is None or n.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Уведомление не найдено")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(n)
    return n


async def mark_all_read(db: AsyncSession, user_id: uuid.UUID) -> int:
    now = datetime.now(timezone.utc)
    res = await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=now)
    )
    await db.commit()
    return int(res.rowcount or 0)
