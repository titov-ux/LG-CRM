"""Сервис activity/audit.

Запись в эти таблицы делается синхронно в той же транзакции, где меняется
основная сущность. По плану это будет переехать в `AuditSubscriber` /
`ActivitySubscriber` поверх доменных событий — на Этапе 5 достаточно
простого helper-API (`record_activity`, `record_audit`).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import (
    ActivityEntityType,
    ActivityEntry,
    ActivityKind,
    AuditEntry,
)


def _stringify(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "value"):  # Enum
        return str(value.value)
    return str(value)


async def record_activity(
    db: AsyncSession,
    *,
    entity_type: ActivityEntityType,
    entity_id: uuid.UUID,
    actor_id: uuid.UUID,
    kind: ActivityKind,
    text: str,
) -> ActivityEntry:
    entry = ActivityEntry(
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
        kind=kind,
        text_=text,
    )
    db.add(entry)
    await db.flush()
    return entry


async def record_audit(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    actor_id: uuid.UUID,
    field: str,
    before: Any,
    after: Any,
) -> AuditEntry:
    entry = AuditEntry(
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
        field=field,
        before=_stringify(before),
        after=_stringify(after),
    )
    db.add(entry)
    await db.flush()
    return entry


async def list_activity(
    db: AsyncSession, entity_type: ActivityEntityType, entity_id: uuid.UUID
) -> list[ActivityEntry]:
    res = await db.execute(
        select(ActivityEntry)
        .where(ActivityEntry.entity_type == entity_type, ActivityEntry.entity_id == entity_id)
        .order_by(ActivityEntry.created_at.desc())
    )
    return list(res.scalars().all())


async def list_audit(
    db: AsyncSession,
    *,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    field: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
) -> list[AuditEntry]:
    q: Select = select(AuditEntry)
    if entity_type:
        q = q.where(AuditEntry.entity_type == entity_type)
    if entity_id:
        q = q.where(AuditEntry.entity_id == entity_id)
    if actor_id:
        q = q.where(AuditEntry.actor_id == actor_id)
    if field:
        q = q.where(AuditEntry.field == field)
    if date_from:
        q = q.where(AuditEntry.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.where(AuditEntry.created_at <= datetime.combine(date_to, datetime.max.time()))
    if search:
        like = f"%{search.lower()}%"
        from sqlalchemy import func, or_

        q = q.where(
            or_(
                func.lower(AuditEntry.field).like(like),
                func.lower(func.coalesce(AuditEntry.before, "")).like(like),
                func.lower(func.coalesce(AuditEntry.after, "")).like(like),
            )
        )
    q = q.order_by(AuditEntry.created_at.desc()).limit(500)
    return list((await db.execute(q)).scalars().all())
