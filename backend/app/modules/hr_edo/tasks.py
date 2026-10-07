"""Celery-задачи кадрового ЭДО (beat — см. app/celery_app.py).

* `hr_edo.remind_unsigned` — ежедневно в 10:00 МСК: письмо-напоминание о
  документах, которые ждут подписи (не чаще раза в сутки на документ);
* `hr_edo.expire_documents` — ежечасно: просроченные документы → `expired`;
* `hr_edo.poll_sms_status` — каждые 5 минут: статусы доставки SMS-кодов;
* `hr_edo.verify_event_chain` — ежедневно: сверка хеш-цепочки протокола,
  при разрыве — ERROR в лог (алерт) и уведомление администраторам.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from app.celery_app import celery_app
from app.core.config import get_settings, hr_edo_is_enabled

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _dispose_after[T](coro: Coroutine[Any, Any, T]) -> T:
    """Отдать пул asyncpg до закрытия loop (см. screening.tasks)."""
    from app.db.session import get_engine

    try:
        return await coro
    finally:
        await get_engine().dispose()


async def remind_unsigned() -> int:
    from app.db.session import SessionLocal
    from app.modules.hr_edo import notify, portal
    from app.modules.hr_edo.evidence import Actor, record_event
    from app.modules.hr_edo.models import (
        HrDocStatus,
        HrDocument,
        HrEmployee,
        HrEmployeeStatus,
        HrEventKind,
    )

    sent = 0
    async with SessionLocal() as db:
        cutoff = _now() - timedelta(hours=20)
        docs = list(
            (
                await db.execute(
                    select(HrDocument)
                    .where(
                        HrDocument.status.in_((HrDocStatus.sent, HrDocStatus.viewed)),
                        HrDocument.sent_at < cutoff,
                        (HrDocument.last_reminded_at.is_(None)) | (HrDocument.last_reminded_at < cutoff),
                    )
                    .order_by(HrDocument.employee_id)
                )
            ).scalars()
        )
        by_emp: dict[object, list[HrDocument]] = {}
        for d in docs:
            by_emp.setdefault(d.employee_id, []).append(d)
        for emp_id, emp_docs in by_emp.items():
            emp = await db.get(HrEmployee, emp_id)
            if emp is None or emp.status != HrEmployeeStatus.active:
                continue
            if emp.user_id:
                url = notify.my_docs_url()
            elif emp.email:
                url = notify.portal_url(await portal.issue_access_token(db, emp, created_by=None))
            else:
                # Письмо не уйдёт — не отзываем ссылку, которую кадровик передал сам.
                continue
            ok = await notify.email_documents_to_sign(
                to=emp.email,
                full_name=emp.full_name,
                titles=[f"{d.title} № {d.number}" if d.number else d.title for d in emp_docs],
                url=url,
                reminder=True,
            )
            for d in emp_docs:
                d.last_reminded_at = _now()
                await record_event(
                    db, kind=HrEventKind.notified, actor=Actor.system(), document_id=d.id,
                    employee_id=emp.id, payload={"reminder": True, "channel": "email" if ok else "none"},
                )
                await notify.notify_user(db, user_id=emp.user_id, text=f"Напоминание: подпишите «{d.title}»", document_id=d.id)
            sent += 1
        await db.commit()
    return sent


async def expire_documents() -> int:
    from app.db.session import SessionLocal
    from app.modules.hr_edo.evidence import Actor, record_event
    from app.modules.hr_edo.models import HrDocStatus, HrDocument, HrEventKind

    async with SessionLocal() as db:
        docs = list(
            (
                await db.execute(
                    select(HrDocument)
                    .where(
                        HrDocument.status.in_((HrDocStatus.sent, HrDocStatus.viewed)),
                        HrDocument.due_at.is_not(None),
                        HrDocument.due_at < _now(),
                    )
                    # Документ, который прямо сейчас подписывают, пропускаем:
                    # иначе после их коммита мы перезаписали бы signed → expired.
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )
        for d in docs:
            d.status = HrDocStatus.expired
            await record_event(
                db, kind=HrEventKind.expired, actor=Actor.system(), document_id=d.id, employee_id=d.employee_id,
                payload={"dueAt": d.due_at.isoformat() if d.due_at else None},
            )
        await db.commit()
        return len(docs)


async def poll_sms_status() -> int:
    from app.db.session import SessionLocal
    from app.integrations.sms import sms_provider
    from app.modules.hr_edo.evidence import Actor, record_event
    from app.modules.hr_edo.models import HrEmployee, HrEventKind, HrSignChallenge

    provider = sms_provider()
    updated = 0
    async with SessionLocal() as db:
        rows = list(
            (
                await db.execute(
                    select(HrSignChallenge).where(
                        HrSignChallenge.sms_delivery_status.in_(("queued", "sent")),
                        HrSignChallenge.sms_provider_id.is_not(None),
                        HrSignChallenge.created_at > _now() - timedelta(hours=1),
                    )
                )
            ).scalars()
        )
        for ch in rows:
            emp = await db.get(HrEmployee, ch.employee_id)
            if emp is None or not emp.phone_e164 or not ch.sms_provider_id:
                continue
            new_status = await provider.status(provider_id=ch.sms_provider_id, phone=emp.phone_e164)
            if new_status == ch.sms_delivery_status:
                continue
            ch.sms_delivery_status = new_status
            updated += 1
            if new_status in ("delivered", "failed"):
                await record_event(
                    db,
                    kind=HrEventKind.otp_delivered if new_status == "delivered" else HrEventKind.otp_failed,
                    actor=Actor.system(),
                    employee_id=ch.employee_id,
                    payload={"challengeId": str(ch.id), "purpose": ch.purpose.value, "phone": ch.phone_masked},
                )
        await db.commit()
    return updated


async def verify_event_chain() -> bool:
    from app.db.session import SessionLocal
    from app.modules.hr_edo.evidence import verify_chain
    from app.modules.notifications import service as notifications_service
    from app.modules.notifications.models import NotificationKind
    from app.modules.users.models import Role, User

    async with SessionLocal() as db:
        result = await verify_chain(db)
        if result.ok:
            logger.info("hr_edo.verify_event_chain: ok, %d events", result.checked)
            return True
        logger.error(
            "hr_edo.verify_event_chain: BROKEN at id=%s reason=%s (checked %d)",
            result.broken_at_id,
            result.reason,
            result.checked,
        )
        admins = (await db.execute(select(User.id).where(User.role == Role.admin, User.is_active.is_(True)))).scalars()
        for admin_id in admins:
            await notifications_service.notify(
                db,
                recipient_id=admin_id,
                kind=NotificationKind.system,
                text=f"Кадровый ЭДО: нарушена целостность протокола (событие #{result.broken_at_id})",
            )
        await db.commit()
        return False


def _run[T](name: str, coro_factory: Callable[[], Coroutine[Any, Any, T]]) -> T | None:
    if not hr_edo_is_enabled(get_settings()):
        return None
    try:
        return asyncio.run(_dispose_after(coro_factory()))
    except Exception:
        logger.exception("%s failed", name)
        raise


@celery_app.task(name="hr_edo.remind_unsigned")  # type: ignore[untyped-decorator]
def remind_unsigned_task() -> int | None:
    return _run("hr_edo.remind_unsigned", remind_unsigned)


@celery_app.task(name="hr_edo.expire_documents")  # type: ignore[untyped-decorator]
def expire_documents_task() -> int | None:
    return _run("hr_edo.expire_documents", expire_documents)


@celery_app.task(name="hr_edo.poll_sms_status")  # type: ignore[untyped-decorator]
def poll_sms_status_task() -> int | None:
    return _run("hr_edo.poll_sms_status", poll_sms_status)


@celery_app.task(name="hr_edo.verify_event_chain")  # type: ignore[untyped-decorator]
def verify_event_chain_task() -> bool | None:
    return _run("hr_edo.verify_event_chain", verify_event_chain)
