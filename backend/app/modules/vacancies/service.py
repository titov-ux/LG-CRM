"""Сервис вакансий: CRUD, фильтры, kanban-операции, переходы статусов.

Видимость по ролям наследует логику из clients-сервиса: account_manager видит
только вакансии, где он — `account_manager_id`. Дополнительно у вакансии есть
recruiters (M2M); recruiter видит свои вакансии и все vacancies клиентов, к
которым его «прикрепили». Для простоты на этапе 4: recruiter/viewer/admin
видят все вакансии; account_manager — только свои.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Iterable

from fastapi import status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ApiError
from app.modules.audit import service as audit_service
from app.modules.audit.models import ActivityEntityType, ActivityKind
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind
from app.modules.users.models import Role, User
from app.modules.vacancies import transitions
from app.realtime.events import publish_vacancy_changed
from app.modules.vacancies.models import (
    EngagementType,
    Grade,
    Priority,
    Vacancy,
    VacancyRecruiter,
    VacancyStatus,
)
from app.modules.vacancies.schemas import (
    ChangeStatusRequest,
    CreateVacancyRequest,
    KanbanUpdate,
    UpdateVacancyRequest,
)


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------


def _scope(q: Select, user: User) -> Select:
    if user.role == Role.account_manager:
        q = q.where(Vacancy.account_manager_id == user.id)
    return q


def _ensure_can_mutate(user: User) -> None:
    if user.role not in (Role.admin, Role.account_manager, Role.recruiter):
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет прав на изменение вакансий")


def _ensure_can_delete(user: User) -> None:
    if user.role not in (Role.admin, Role.account_manager):
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Удаление вакансий — admin/AM")


def _ensure_can_see(vac: Vacancy, user: User) -> None:
    if user.role == Role.account_manager and vac.account_manager_id != user.id:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет доступа к вакансии")


# ---------------------------------------------------------------------------
# Derived fields
# ---------------------------------------------------------------------------


def _days_in_status(vac: Vacancy) -> int:
    if not vac.status_changed_at:
        return 0
    delta = datetime.now(timezone.utc) - vac.status_changed_at
    return max(int(delta.total_seconds() // 86400), 0)


def _recruiter_ids(vac: Vacancy) -> list[uuid.UUID]:
    return [r.user_id for r in vac.recruiters]


def _next_kanban_order(rows: Iterable[Vacancy], target_status: VacancyStatus) -> int:
    in_column = [v.kanban_order for v in rows if v.status == target_status]
    return max(in_column) + 1 if in_column else 0


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def _base_query() -> Select:
    return (
        select(Vacancy)
        .where(Vacancy.deleted_at.is_(None))
        .options(selectinload(Vacancy.recruiters))
    )


async def list_vacancies(
    db: AsyncSession,
    user: User,
    *,
    search: str | None = None,
    status_: VacancyStatus | None = None,
    client_id: uuid.UUID | None = None,
    grade: Grade | None = None,
    priority: Priority | None = None,
    recruiter_id: uuid.UUID | None = None,
    account_manager_id: uuid.UUID | None = None,
    engagement_type: EngagementType | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Vacancy], int]:
    q = _scope(_base_query(), user)
    if status_ is not None:
        q = q.where(Vacancy.status == status_)
    if client_id is not None:
        q = q.where(Vacancy.client_id == client_id)
    if grade is not None:
        q = q.where(Vacancy.grade == grade)
    if priority is not None:
        q = q.where(Vacancy.priority == priority)
    if engagement_type is not None:
        q = q.where(Vacancy.engagement_type == engagement_type)
    if account_manager_id is not None:
        q = q.where(Vacancy.account_manager_id == account_manager_id)
    if recruiter_id is not None:
        subq = select(VacancyRecruiter.vacancy_id).where(VacancyRecruiter.user_id == recruiter_id)
        q = q.where(Vacancy.id.in_(subq))
    if search:
        like = f"%{search.lower()}%"
        q = q.where(func.lower(Vacancy.title).like(like))

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()

    q = (
        q.order_by(Vacancy.status, Vacancy.kanban_order, Vacancy.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = list((await db.execute(q)).scalars().all())
    return rows, int(total)


async def get_vacancy(db: AsyncSession, user: User, vac_id: uuid.UUID) -> Vacancy:
    vac = (await db.execute(_base_query().where(Vacancy.id == vac_id))).scalar_one_or_none()
    if vac is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Вакансия не найдена")
    _ensure_can_see(vac, user)
    return vac


async def create_vacancy(
    db: AsyncSession, user: User, payload: CreateVacancyRequest
) -> Vacancy:
    _ensure_can_mutate(user)
    # AM может создавать вакансии только на себя (или вообще без AM-а — это
    # запрещено, иначе он мог бы «обойти» scope-проверку).
    if user.role == Role.account_manager and payload.account_manager_id != user.id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Аккаунт-менеджер может создавать вакансии только на себя",
        )
    # Авто-вычисление kanban_order — в конец колонки своего status.
    existing = (await db.execute(_scope(_base_query(), user))).scalars().all()
    order = _next_kanban_order(existing, payload.status)
    vac = Vacancy(
        title=payload.title,
        client_id=payload.client_id,
        engagement_type=payload.engagement_type,
        project=payload.project,
        grade=payload.grade,
        stack=list(payload.stack),
        format_=payload.format,
        rate_client=float(payload.rate_client),
        salary_max=float(payload.salary_max) if payload.salary_max is not None else None,
        positions=payload.positions,
        status=payload.status,
        priority=payload.priority,
        account_manager_id=payload.account_manager_id,
        deadline=payload.deadline,
        kanban_order=order,
        description=payload.description,
        requirements=payload.requirements,
        status_changed_at=datetime.now(timezone.utc),
    )
    for rid in payload.recruiter_ids:
        vac.recruiters.append(VacancyRecruiter(user_id=rid))
    db.add(vac)
    await db.flush()
    await audit_service.record_activity(
        db,
        entity_type=ActivityEntityType.vacancy,
        entity_id=vac.id,
        actor_id=user.id,
        kind=ActivityKind.create,
        text=f"Вакансия «{vac.title}» создана",
    )
    await db.commit()
    await db.refresh(vac, attribute_names=["recruiters"])
    publish_vacancy_changed("created", id=vac.id, actor_id=user.id)
    return vac


async def update_vacancy(
    db: AsyncSession, user: User, vac_id: uuid.UUID, payload: UpdateVacancyRequest
) -> Vacancy:
    _ensure_can_mutate(user)
    vac = await get_vacancy(db, user, vac_id)
    data = payload.model_dump(exclude_unset=True)

    # Простые поля.
    for field in (
        "title",
        "client_id",
        "engagement_type",
        "project",
        "grade",
        "format",
        "positions",
        "priority",
        "deadline",
        "description",
        "requirements",
    ):
        if field in data:
            attr = "format_" if field == "format" else field
            setattr(vac, attr, data[field])
    if "stack" in data and data["stack"] is not None:
        vac.stack = list(data["stack"])
    if "rate_client" in data and data["rate_client"] is not None:
        vac.rate_client = float(data["rate_client"])
    if "salary_max" in data:
        v = data["salary_max"]
        vac.salary_max = float(v) if v is not None else None
    if "account_manager_id" in data:
        # Допускаем null: фронт может «отвязать» ответственного.
        new_am = data["account_manager_id"]
        if user.role == Role.account_manager and new_am != user.id:
            raise ApiError(
                status.HTTP_403_FORBIDDEN, "forbidden", "Сменить AM может только админ"
            )
        vac.account_manager_id = new_am
    if "recruiter_ids" in data and data["recruiter_ids"] is not None:
        _replace_recruiters(vac, list(data["recruiter_ids"]))

    await db.commit()
    await db.refresh(vac, attribute_names=["recruiters"])
    publish_vacancy_changed("updated", id=vac.id, actor_id=user.id)
    return vac


def _replace_recruiters(vac: Vacancy, ids: list[uuid.UUID]) -> None:
    current = {r.user_id for r in vac.recruiters}
    target = set(ids)
    # удалить лишние
    vac.recruiters = [r for r in vac.recruiters if r.user_id in target]
    # добавить недостающие
    for new_id in target - current:
        vac.recruiters.append(VacancyRecruiter(user_id=new_id))


async def delete_vacancy(db: AsyncSession, user: User, vac_id: uuid.UUID) -> None:
    _ensure_can_delete(user)
    vac = await get_vacancy(db, user, vac_id)
    vac.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    publish_vacancy_changed("deleted", id=vac_id, actor_id=user.id)


# ---------------------------------------------------------------------------
# Kanban: смена статуса + batch reorder
# ---------------------------------------------------------------------------


async def change_status(
    db: AsyncSession, user: User, vac_id: uuid.UUID, payload: ChangeStatusRequest
) -> Vacancy:
    _ensure_can_mutate(user)
    vac = await get_vacancy(db, user, vac_id)
    if not transitions.is_allowed(vac.status, payload.status):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_transition",
            f"Переход {vac.status.value} → {payload.status.value} запрещён",
            details={
                "from": vac.status.value,
                "to": payload.status.value,
                "allowed": sorted(s.value for s in transitions.allowed_next(vac.status)),
            },
        )
    if transitions.is_final(payload.status) and not (payload.comment and payload.comment.strip()):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "comment_required",
            "Перевод в финальный статус требует комментария",
        )

    if vac.status != payload.status:
        before_status = vac.status.value
        vac.status = payload.status
        vac.status_changed_at = datetime.now(timezone.utc)
        # При смене колонки сбрасываем kanban_order — пересчёт в конец новой колонки.
        peers = (
            await db.execute(
                _scope(_base_query(), user).where(Vacancy.status == payload.status)
            )
        ).scalars().all()
        vac.kanban_order = (max((p.kanban_order for p in peers), default=-1)) + 1
        # Запись в audit + activity синхронно (в той же транзакции).
        await audit_service.record_audit(
            db,
            entity_type="vacancy",
            entity_id=vac.id,
            actor_id=user.id,
            field="status",
            before=before_status,
            after=payload.status.value,
        )
        await audit_service.record_activity(
            db,
            entity_type=ActivityEntityType.vacancy,
            entity_id=vac.id,
            actor_id=user.id,
            kind=ActivityKind.status,
            text=(
                f"Статус изменён: {before_status} → {payload.status.value}"
                + (f". {payload.comment}" if payload.comment else "")
            ),
        )
        # Уведомление рекрутерам + AM (кроме того, кто менял). AM может быть None
        # (FK SET NULL после удаления пользователя) — такие записи не уведомляем.
        recipients = {r.user_id for r in vac.recruiters}
        if vac.account_manager_id is not None:
            recipients.add(vac.account_manager_id)
        recipients.discard(user.id)
        if recipients:
            await notify_service.notify_many(
                db,
                recipient_ids=recipients,
                kind=NotificationKind.status_change,
                text=f"Вакансия «{vac.title}»: статус {before_status} → {payload.status.value}",
                entity_type=NotificationEntityType.vacancy,
                entity_id=vac.id,
            )
    await db.commit()
    await db.refresh(vac, attribute_names=["recruiters"])
    publish_vacancy_changed("status_changed", id=vac.id, actor_id=user.id)
    return vac


async def reorder_kanban(
    db: AsyncSession, user: User, updates: list[KanbanUpdate]
) -> list[Vacancy]:
    _ensure_can_mutate(user)
    ids = [u.id for u in updates]
    if not ids:
        return []
    rows = (await db.execute(_scope(_base_query(), user).where(Vacancy.id.in_(ids)))).scalars().all()
    by_id = {v.id: v for v in rows}
    if len(by_id) != len(ids):
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Не все вакансии найдены")

    now = datetime.now(timezone.utc)
    for upd in updates:
        v = by_id[upd.id]
        if v.status != upd.status:
            before_status = v.status.value
            if not transitions.is_allowed(v.status, upd.status):
                raise ApiError(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "invalid_transition",
                    f"Переход {v.status.value} → {upd.status.value} запрещён",
                )
            if transitions.is_final(upd.status):
                raise ApiError(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "comment_required",
                    "Перевод в финальный статус через kanban-reorder запрещён — нужен PATCH /status с комментарием",
                )
            v.status = upd.status
            v.status_changed_at = now
            await audit_service.record_audit(
                db,
                entity_type="vacancy",
                entity_id=v.id,
                actor_id=user.id,
                field="status",
                before=before_status,
                after=upd.status.value,
            )
            await audit_service.record_activity(
                db,
                entity_type=ActivityEntityType.vacancy,
                entity_id=v.id,
                actor_id=user.id,
                kind=ActivityKind.status,
                text=f"Статус изменён: {before_status} → {upd.status.value}",
            )
            recipients = {r.user_id for r in v.recruiters}
            if v.account_manager_id is not None:
                recipients.add(v.account_manager_id)
            recipients.discard(user.id)
            if recipients:
                await notify_service.notify_many(
                    db,
                    recipient_ids=recipients,
                    kind=NotificationKind.status_change,
                    text=f"Вакансия «{v.title}»: статус {before_status} → {upd.status.value}",
                    entity_type=NotificationEntityType.vacancy,
                    entity_id=v.id,
                )
        v.kanban_order = upd.kanban_order

    await db.commit()
    for v in rows:
        await db.refresh(v, attribute_names=["recruiters"])
    publish_vacancy_changed(
        "reordered",
        ids=[v.id for v in rows],
        actor_id=user.id,
    )
    return list(rows)
