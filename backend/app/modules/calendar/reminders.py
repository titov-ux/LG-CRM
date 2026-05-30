"""Фоновый свипер напоминаний о собеседованиях.

Раз в минуту ищет запланированные события, начало которых попадает в окно
«сейчас … +REMINDER_LEAD», по которым напоминание ещё не отправлялось
(`reminder_sent_at IS NULL`), и шлёт уведомления участникам. Затем проставляет
`reminder_sent_at`, чтобы не дублировать.

Запускается во всех воркерах; гонка безопасна — `reminder_sent_at` ставится в
транзакции, и повторная выборка уже не зацепит обработанные строки (а в худшем
случае придёт лишнее уведомление, что не критично).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import SessionLocal
from app.modules.calendar.models import CalendarEvent, EventStatus, EventType
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind

logger = logging.getLogger(__name__)

REMINDER_LEAD = timedelta(minutes=30)
_TICK_SECONDS = 60

_task: asyncio.Task[None] | None = None
_stopped = False


async def _run_once() -> int:
    now = datetime.now(timezone.utc)
    horizon = now + REMINDER_LEAD
    async with SessionLocal() as db:
        rows = await db.execute(
            select(CalendarEvent)
            .where(
                CalendarEvent.status == EventStatus.scheduled,
                CalendarEvent.type == EventType.interview,
                CalendarEvent.reminder_sent_at.is_(None),
                CalendarEvent.starts_at > now,
                CalendarEvent.starts_at <= horizon,
            )
            .options(selectinload(CalendarEvent.attendees))
        )
        events = list(rows.scalars().all())
        sent = 0
        for event in events:
            audience = {a.user_id for a in event.attendees}
            if event.created_by_id is not None:
                audience.add(event.created_by_id)
            if audience:
                await notify_service.notify_many(
                    db,
                    recipient_ids=audience,
                    kind=NotificationKind.system,
                    text=f"Скоро собеседование: {event.title}",
                    entity_type=NotificationEntityType.event,
                    entity_id=event.id,
                    payload={"startsAt": event.starts_at.isoformat()},
                )
            event.reminder_sent_at = now
            sent += 1
        if events:
            await db.commit()
        return sent


async def _loop() -> None:
    while not _stopped:
        try:
            await _run_once()
        except Exception:
            logger.exception("calendar reminders: tick failed (continuing)")
        await asyncio.sleep(_TICK_SECONDS)


async def start_reminders() -> None:
    global _task, _stopped
    _stopped = False
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


async def stop_reminders() -> None:
    global _stopped
    _stopped = True
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
