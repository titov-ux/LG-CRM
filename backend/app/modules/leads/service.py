"""Сервис лидов: CRUD, фильтры, kanban-операции, переходы статусов.

Видимость по ролям зеркалит tenders-сервис: account_manager видит только
лиды, где он — `account_manager_id`; остальные роли видят все.
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
from app.modules.clients.models import Client
from app.modules.leads import transitions
from app.modules.leads.models import Lead, LeadStatus
from app.modules.leads.schemas import (
    ChangeStatusRequest,
    CreateLeadRequest,
    KanbanUpdate,
    UpdateLeadRequest,
)
from app.modules.users.models import Role, User
from app.modules.vacancies.models import Priority
from app.realtime.events import publish_lead_changed

# Строковые поля, которые копируются из payload «как есть» (пустая строка → NULL).
_TEXT_FIELDS: tuple[str, ...] = (
    "industry",
    "website",
    "contact_name",
    "contact_position",
    "phone",
    "email",
    "telegram",
    "source",
    "note",
)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------


def _scope(q: Select, user: User) -> Select:
    if user.role == Role.account_manager:
        q = q.where(Lead.account_manager_id == user.id)
    return q


def _ensure_can_mutate(user: User) -> None:
    if user.role not in (Role.admin, Role.account_manager, Role.recruiter):
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет прав на изменение лидов")


def _ensure_can_delete(user: User) -> None:
    if user.role not in (Role.admin, Role.account_manager):
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Удаление лидов — admin/AM")


def _ensure_can_see(lead: Lead, user: User) -> None:
    if user.role == Role.account_manager and lead.account_manager_id != user.id:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет доступа к лиду")


# ---------------------------------------------------------------------------
# Derived fields
# ---------------------------------------------------------------------------


def days_in_status(lead: Lead) -> int:
    if not lead.status_changed_at:
        return 0
    delta = datetime.now(timezone.utc) - lead.status_changed_at
    return max(int(delta.total_seconds() // 86400), 0)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def _base_query() -> Select:
    return select(Lead).where(Lead.deleted_at.is_(None))


async def _next_order(db: AsyncSession, user: User, target_status: LeadStatus) -> int:
    max_q = (
        select(func.max(Lead.kanban_order))
        .where(Lead.deleted_at.is_(None))
        .where(Lead.status == target_status)
    )
    if user.role == Role.account_manager:
        max_q = max_q.where(Lead.account_manager_id == user.id)
    max_order = (await db.execute(max_q)).scalar()
    return (max_order + 1) if isinstance(max_order, int) else 0


async def list_leads(
    db: AsyncSession,
    user: User,
    *,
    search: str | None = None,
    status_: LeadStatus | None = None,
    priority: Priority | None = None,
    source: str | None = None,
    account_manager_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Lead], int]:
    q = _scope(_base_query(), user)
    if status_ is not None:
        q = q.where(Lead.status == status_)
    if priority is not None:
        q = q.where(Lead.priority == priority)
    if source:
        q = q.where(Lead.source == source)
    if account_manager_id is not None:
        q = q.where(Lead.account_manager_id == account_manager_id)
    if search:
        like = f"%{search.lower()}%"
        q = q.where(
            func.lower(Lead.title).like(like)
            | func.lower(Lead.company).like(like)
            | func.lower(func.coalesce(Lead.contact_name, "")).like(like)
            | func.lower(func.coalesce(Lead.email, "")).like(like)
            | func.coalesce(Lead.phone, "").like(f"%{search}%")
        )

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()

    q = (
        q.order_by(Lead.status, Lead.kanban_order, Lead.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = list((await db.execute(q)).scalars().all())
    return rows, int(total)


async def get_lead(db: AsyncSession, user: User, lead_id: uuid.UUID) -> Lead:
    lead = (await db.execute(_base_query().where(Lead.id == lead_id))).scalar_one_or_none()
    if lead is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Лид не найден")
    _ensure_can_see(lead, user)
    return lead


async def create_lead(db: AsyncSession, user: User, payload: CreateLeadRequest) -> Lead:
    _ensure_can_mutate(user)
    account_manager_id = payload.account_manager_id
    if user.role == Role.account_manager:
        # AM не указал ответственного — назначаем его самого; чужого назначить нельзя.
        if account_manager_id is None:
            account_manager_id = user.id
        elif account_manager_id != user.id:
            raise ApiError(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "Аккаунт-менеджер может создавать лиды только на себя",
            )
    order = await _next_order(db, user, payload.status)
    lead = Lead(
        title=payload.title.strip(),
        company=(payload.company or "").strip(),
        expected_value=(
            float(payload.expected_value) if payload.expected_value is not None else None
        ),
        next_contact_date=payload.next_contact_date,
        status=payload.status,
        priority=payload.priority,
        account_manager_id=account_manager_id,
        kanban_order=order,
        status_changed_at=datetime.now(timezone.utc),
    )
    for field in _TEXT_FIELDS:
        setattr(lead, field, _clean(getattr(payload, field)))
    db.add(lead)
    await db.flush()
    await audit_service.record_activity(
        db,
        entity_type=ActivityEntityType.lead,
        entity_id=lead.id,
        actor_id=user.id,
        kind=ActivityKind.create,
        text=f"Лид «{lead.title}» создан",
    )
    await db.commit()
    await db.refresh(lead)
    publish_lead_changed("created", id=lead.id, actor_id=user.id)
    return lead


async def update_lead(
    db: AsyncSession, user: User, lead_id: uuid.UUID, payload: UpdateLeadRequest
) -> Lead:
    _ensure_can_mutate(user)
    lead = await get_lead(db, user, lead_id)
    data = payload.model_dump(exclude_unset=True)

    if "title" in data and data["title"] is not None:
        lead.title = data["title"].strip()
    if "company" in data:
        lead.company = (data["company"] or "").strip()
    for field in _TEXT_FIELDS:
        if field in data:
            setattr(lead, field, _clean(data[field]))
    if "next_contact_date" in data:
        lead.next_contact_date = data["next_contact_date"]
    if "client_id" in data:
        client_id = data["client_id"]
        if client_id is not None and await db.get(Client, client_id) is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Клиент не найден")
        lead.client_id = client_id
    if "priority" in data and data["priority"] is not None:
        lead.priority = data["priority"]
    if "expected_value" in data:
        v = data["expected_value"]
        lead.expected_value = float(v) if v is not None else None

    if "account_manager_id" in data:
        new_am = data["account_manager_id"]
        if user.role == Role.account_manager and new_am != user.id:
            raise ApiError(
                status.HTTP_403_FORBIDDEN, "forbidden", "Сменить ответственного может только админ"
            )
        lead.account_manager_id = new_am

    await db.commit()
    await db.refresh(lead)
    publish_lead_changed("updated", id=lead.id, actor_id=user.id)
    return lead


async def delete_lead(db: AsyncSession, user: User, lead_id: uuid.UUID) -> None:
    _ensure_can_delete(user)
    lead = await get_lead(db, user, lead_id)
    lead.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    publish_lead_changed("deleted", id=lead_id, actor_id=user.id)


# ---------------------------------------------------------------------------
# Kanban: смена статуса + batch reorder
# ---------------------------------------------------------------------------


async def _record_status_change(
    db: AsyncSession, user: User, lead: Lead, before: str, comment: str | None = None
) -> None:
    await audit_service.record_audit(
        db,
        entity_type="lead",
        entity_id=lead.id,
        actor_id=user.id,
        field="status",
        before=before,
        after=lead.status.value,
    )
    await audit_service.record_activity(
        db,
        entity_type=ActivityEntityType.lead,
        entity_id=lead.id,
        actor_id=user.id,
        kind=ActivityKind.status,
        text=f"Статус изменён: {before} → {lead.status.value}" + (f". {comment}" if comment else ""),
    )


async def change_status(
    db: AsyncSession, user: User, lead_id: uuid.UUID, payload: ChangeStatusRequest
) -> Lead:
    _ensure_can_mutate(user)
    lead = await get_lead(db, user, lead_id)
    if not transitions.is_allowed(lead.status, payload.status):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_transition",
            f"Переход {lead.status.value} → {payload.status.value} запрещён",
            details={
                "from": lead.status.value,
                "to": payload.status.value,
                "allowed": sorted(s.value for s in transitions.allowed_next(lead.status)),
            },
        )
    comment = (payload.comment or "").strip() or None
    if transitions.is_final(payload.status) and not comment:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "comment_required",
            "Перевод в финальный статус требует комментария",
        )

    if lead.status != payload.status:
        before_status = lead.status.value
        lead.status = payload.status
        lead.status_changed_at = datetime.now(timezone.utc)
        lead.kanban_order = await _next_order(db, user, payload.status)
        if comment:
            stamp = datetime.now(timezone.utc).date().isoformat()
            line = f"[{stamp}] {payload.status.value}: {comment}"
            lead.note = f"{lead.note}\n{line}" if lead.note else line
        await _record_status_change(db, user, lead, before_status, comment)

    await db.commit()
    await db.refresh(lead)
    publish_lead_changed("status_changed", id=lead.id, actor_id=user.id)
    return lead


async def reorder_kanban(db: AsyncSession, user: User, updates: list[KanbanUpdate]) -> list[Lead]:
    _ensure_can_mutate(user)
    ids = [u.id for u in updates]
    if not ids:
        return []
    rows = (
        (await db.execute(_scope(_base_query(), user).where(Lead.id.in_(ids))))
        .scalars()
        .all()
    )
    by_id = {t.id: t for t in rows}
    if len(by_id) != len(ids):
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Не все лиды найдены")

    now = datetime.now(timezone.utc)
    for upd in updates:
        lead = by_id[upd.id]
        if lead.status != upd.status:
            if not transitions.is_allowed(lead.status, upd.status):
                raise ApiError(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "invalid_transition",
                    f"Переход {lead.status.value} → {upd.status.value} запрещён",
                )
            if transitions.is_final(upd.status):
                raise ApiError(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "comment_required",
                    "Перевод в финальный статус через kanban-reorder запрещён — нужен PATCH /status с комментарием",
                )
            before_status = lead.status.value
            lead.status = upd.status
            lead.status_changed_at = now
            await _record_status_change(db, user, lead, before_status)
        lead.kanban_order = upd.kanban_order

    await db.commit()
    publish_lead_changed("reordered", ids=[t.id for t in rows], actor_id=user.id)
    return list(rows)
