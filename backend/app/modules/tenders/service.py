"""Сервис тендеров: CRUD, фильтры, kanban-операции, переходы статусов.

Видимость по ролям зеркалит vacancies-сервис: account_manager видит только
тендеры, где он — `account_manager_id`; остальные роли видят все.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.audit import service as audit_service
from app.modules.audit.models import ActivityEntityType, ActivityKind
from app.modules.tenders import transitions
from app.modules.tenders.models import Tender, TenderLaw, TenderStatus
from app.modules.tenders.schemas import (
    ChangeStatusRequest,
    CreateTenderRequest,
    KanbanUpdate,
    UpdateTenderRequest,
)
from app.modules.users.models import Role, User
from app.modules.vacancies.models import Priority
from app.realtime.events import publish_tender_changed


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------


def _scope(q: Select, user: User) -> Select:
    if user.role == Role.account_manager:
        q = q.where(Tender.account_manager_id == user.id)
    return q


def _ensure_can_mutate(user: User) -> None:
    if user.role not in (Role.admin, Role.account_manager, Role.recruiter):
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет прав на изменение тендеров")


def _ensure_can_delete(user: User) -> None:
    if user.role not in (Role.admin, Role.account_manager):
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Удаление тендеров — admin/AM")


def _ensure_can_see(tender: Tender, user: User) -> None:
    if user.role == Role.account_manager and tender.account_manager_id != user.id:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет доступа к тендеру")


# ---------------------------------------------------------------------------
# Derived fields
# ---------------------------------------------------------------------------


def days_in_status(tender: Tender) -> int:
    if not tender.status_changed_at:
        return 0
    delta = datetime.now(timezone.utc) - tender.status_changed_at
    return max(int(delta.total_seconds() // 86400), 0)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def _base_query() -> Select:
    return select(Tender).where(Tender.deleted_at.is_(None))


async def _next_order(db: AsyncSession, user: User, target_status: TenderStatus) -> int:
    max_q = (
        select(func.max(Tender.kanban_order))
        .where(Tender.deleted_at.is_(None))
        .where(Tender.status == target_status)
    )
    if user.role == Role.account_manager:
        max_q = max_q.where(Tender.account_manager_id == user.id)
    max_order = (await db.execute(max_q)).scalar()
    return (max_order + 1) if isinstance(max_order, int) else 0


async def list_tenders(
    db: AsyncSession,
    user: User,
    *,
    search: str | None = None,
    status_: TenderStatus | None = None,
    law: TenderLaw | None = None,
    priority: Priority | None = None,
    platform: str | None = None,
    account_manager_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Tender], int]:
    q = _scope(_base_query(), user)
    if status_ is not None:
        q = q.where(Tender.status == status_)
    if law is not None:
        q = q.where(Tender.law == law)
    if priority is not None:
        q = q.where(Tender.priority == priority)
    if platform:
        q = q.where(Tender.platform == platform)
    if account_manager_id is not None:
        q = q.where(Tender.account_manager_id == account_manager_id)
    if search:
        like = f"%{search.lower()}%"
        q = q.where(
            func.lower(Tender.title).like(like) | func.lower(Tender.customer).like(like)
        )

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()

    q = (
        q.order_by(Tender.status, Tender.kanban_order, Tender.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = list((await db.execute(q)).scalars().all())
    return rows, int(total)


async def get_tender(db: AsyncSession, user: User, tender_id: uuid.UUID) -> Tender:
    tender = (await db.execute(_base_query().where(Tender.id == tender_id))).scalar_one_or_none()
    if tender is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Тендер не найден")
    _ensure_can_see(tender, user)
    return tender


async def create_tender(
    db: AsyncSession, user: User, payload: CreateTenderRequest
) -> Tender:
    _ensure_can_mutate(user)
    if user.role == Role.account_manager and payload.account_manager_id != user.id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Аккаунт-менеджер может создавать тендеры только на себя",
        )
    order = await _next_order(db, user, payload.status)
    tender = Tender(
        title=payload.title,
        customer=payload.customer or "",
        registry_number=payload.registry_number,
        platform=payload.platform,
        law=payload.law,
        nmck=float(payload.nmck or 0),
        our_price=float(payload.our_price) if payload.our_price is not None else None,
        security_amount=(
            float(payload.security_amount) if payload.security_amount is not None else None
        ),
        submission_deadline=payload.submission_deadline,
        auction_date=payload.auction_date,
        status=payload.status,
        priority=payload.priority,
        account_manager_id=payload.account_manager_id,
        kanban_order=order,
        url=payload.url,
        note=payload.note,
        status_changed_at=datetime.now(timezone.utc),
    )
    db.add(tender)
    await db.flush()
    await audit_service.record_activity(
        db,
        entity_type=ActivityEntityType.tender,
        entity_id=tender.id,
        actor_id=user.id,
        kind=ActivityKind.create,
        text=f"Тендер «{tender.title}» создан",
    )
    await db.commit()
    await db.refresh(tender)
    publish_tender_changed("created", id=tender.id, actor_id=user.id)
    return tender


async def update_tender(
    db: AsyncSession, user: User, tender_id: uuid.UUID, payload: UpdateTenderRequest
) -> Tender:
    _ensure_can_mutate(user)
    tender = await get_tender(db, user, tender_id)
    data = payload.model_dump(exclude_unset=True)

    for field in (
        "title",
        "customer",
        "registry_number",
        "platform",
        "law",
        "submission_deadline",
        "auction_date",
        "priority",
        "url",
        "note",
    ):
        if field in data:
            setattr(tender, field, data[field])
    for money in ("nmck", "our_price", "security_amount"):
        if money in data:
            v = data[money]
            setattr(tender, money, float(v) if v is not None else None)

    if "account_manager_id" in data:
        new_am = data["account_manager_id"]
        if user.role == Role.account_manager and new_am != user.id:
            raise ApiError(
                status.HTTP_403_FORBIDDEN, "forbidden", "Сменить ответственного может только админ"
            )
        tender.account_manager_id = new_am

    await db.commit()
    await db.refresh(tender)
    publish_tender_changed("updated", id=tender.id, actor_id=user.id)
    return tender


async def delete_tender(db: AsyncSession, user: User, tender_id: uuid.UUID) -> None:
    _ensure_can_delete(user)
    tender = await get_tender(db, user, tender_id)
    tender.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    publish_tender_changed("deleted", id=tender_id, actor_id=user.id)


# ---------------------------------------------------------------------------
# Kanban: смена статуса + batch reorder
# ---------------------------------------------------------------------------


async def change_status(
    db: AsyncSession, user: User, tender_id: uuid.UUID, payload: ChangeStatusRequest
) -> Tender:
    _ensure_can_mutate(user)
    tender = await get_tender(db, user, tender_id)
    if not transitions.is_allowed(tender.status, payload.status):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_transition",
            f"Переход {tender.status.value} → {payload.status.value} запрещён",
            details={
                "from": tender.status.value,
                "to": payload.status.value,
                "allowed": sorted(s.value for s in transitions.allowed_next(tender.status)),
            },
        )
    if transitions.is_final(payload.status) and not (payload.comment and payload.comment.strip()):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "comment_required",
            "Перевод в финальный статус требует комментария",
        )

    if tender.status != payload.status:
        before_status = tender.status.value
        tender.status = payload.status
        tender.status_changed_at = datetime.now(timezone.utc)
        tender.kanban_order = await _next_order(db, user, payload.status)
        if payload.comment and payload.comment.strip():
            stamp = datetime.now(timezone.utc).date().isoformat()
            line = f"[{stamp}] {payload.status.value}: {payload.comment.strip()}"
            tender.note = f"{tender.note}\n{line}" if tender.note else line
        await audit_service.record_audit(
            db,
            entity_type="tender",
            entity_id=tender.id,
            actor_id=user.id,
            field="status",
            before=before_status,
            after=payload.status.value,
        )
        await audit_service.record_activity(
            db,
            entity_type=ActivityEntityType.tender,
            entity_id=tender.id,
            actor_id=user.id,
            kind=ActivityKind.status,
            text=(
                f"Статус изменён: {before_status} → {payload.status.value}"
                + (f". {payload.comment.strip()}" if payload.comment and payload.comment.strip() else "")
            ),
        )

    await db.commit()
    await db.refresh(tender)
    publish_tender_changed("status_changed", id=tender.id, actor_id=user.id)
    return tender


async def reorder_kanban(
    db: AsyncSession, user: User, updates: list[KanbanUpdate]
) -> list[Tender]:
    _ensure_can_mutate(user)
    ids = [u.id for u in updates]
    if not ids:
        return []
    rows = (
        (await db.execute(_scope(_base_query(), user).where(Tender.id.in_(ids))))
        .scalars()
        .all()
    )
    by_id = {t.id: t for t in rows}
    if len(by_id) != len(ids):
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Не все тендеры найдены")

    now = datetime.now(timezone.utc)
    for upd in updates:
        t = by_id[upd.id]
        if t.status != upd.status:
            if not transitions.is_allowed(t.status, upd.status):
                raise ApiError(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "invalid_transition",
                    f"Переход {t.status.value} → {upd.status.value} запрещён",
                )
            if transitions.is_final(upd.status):
                raise ApiError(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "comment_required",
                    "Перевод в финальный статус через kanban-reorder запрещён — нужен PATCH /status с комментарием",
                )
            before_status = t.status.value
            t.status = upd.status
            t.status_changed_at = now
            await audit_service.record_audit(
                db,
                entity_type="tender",
                entity_id=t.id,
                actor_id=user.id,
                field="status",
                before=before_status,
                after=upd.status.value,
            )
            await audit_service.record_activity(
                db,
                entity_type=ActivityEntityType.tender,
                entity_id=t.id,
                actor_id=user.id,
                kind=ActivityKind.status,
                text=f"Статус изменён: {before_status} → {upd.status.value}",
            )
        t.kanban_order = upd.kanban_order

    await db.commit()
    publish_tender_changed("reordered", ids=[t.id for t in rows], actor_id=user.id)
    return list(rows)
