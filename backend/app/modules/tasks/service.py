"""Сервис задач: CRUD, фильтры, kanban-операции, уведомления.

Доска общая для команды: все роли видят все задачи. Менять задачи (создавать,
редактировать, двигать по доске) может любой, кроме роли `viewer`. Удалять —
постановщик задачи или админ.

Уведомления:
* исполнителю — когда задачу назначили на него (при создании или смене
  исполнителя), если назначил не он сам;
* постановщику — когда задачу перевели в «Готово» (если это сделал не он).
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
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind
from app.modules.tasks.models import Task, TaskStatus
from app.modules.tasks.schemas import CreateTaskRequest, KanbanUpdate, UpdateTaskRequest
from app.modules.users.models import Role, User
from app.modules.vacancies.models import Priority
from app.realtime.events import publish_task_changed

STATUS_LABELS: dict[TaskStatus, str] = {
    TaskStatus.todo: "К выполнению",
    TaskStatus.in_progress: "В работе",
    TaskStatus.review: "На проверке",
    TaskStatus.done: "Готово",
}


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------


def _ensure_can_mutate(user: User) -> None:
    if user.role == Role.viewer:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет прав на изменение задач")


def _ensure_can_delete(task: Task, user: User) -> None:
    if user.role != Role.admin and task.author_id != user.id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Удалить задачу может только её постановщик или администратор",
        )


async def _ensure_assignee(db: AsyncSession, assignee_id: uuid.UUID | None) -> User | None:
    if assignee_id is None:
        return None
    assignee = await db.get(User, assignee_id)
    if assignee is None or not assignee.is_active:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_assignee",
            "Исполнитель не найден или деактивирован",
        )
    return assignee


# ---------------------------------------------------------------------------
# Derived fields
# ---------------------------------------------------------------------------


def days_in_status(task: Task) -> int:
    if not task.status_changed_at:
        return 0
    delta = datetime.now(timezone.utc) - task.status_changed_at
    return max(int(delta.total_seconds() // 86400), 0)


def _apply_status(task: Task, new_status: TaskStatus, now: datetime) -> None:
    task.status = new_status
    task.status_changed_at = now
    task.completed_at = now if new_status == TaskStatus.done else None


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


async def _notify_assigned(db: AsyncSession, task: Task, actor: User) -> None:
    if task.assignee_id is None or task.assignee_id == actor.id:
        return
    await notify_service.notify(
        db,
        recipient_id=task.assignee_id,
        kind=NotificationKind.assignment,
        text=f"{actor.full_name} назначил(а) вам задачу «{task.title}»",
        entity_type=NotificationEntityType.task,
        entity_id=task.id,
    )


async def _notify_done(db: AsyncSession, task: Task, actor: User) -> None:
    if task.author_id is None or task.author_id == actor.id:
        return
    await notify_service.notify(
        db,
        recipient_id=task.author_id,
        kind=NotificationKind.status_change,
        text=f"{actor.full_name} выполнил(а) задачу «{task.title}»",
        entity_type=NotificationEntityType.task,
        entity_id=task.id,
    )


async def _record_status_change(
    db: AsyncSession, task: Task, actor: User, before: TaskStatus
) -> None:
    await audit_service.record_audit(
        db,
        entity_type="task",
        entity_id=task.id,
        actor_id=actor.id,
        field="status",
        before=before.value,
        after=task.status.value,
    )
    await audit_service.record_activity(
        db,
        entity_type=ActivityEntityType.task,
        entity_id=task.id,
        actor_id=actor.id,
        kind=ActivityKind.status,
        text=f"Статус изменён: {STATUS_LABELS[before]} → {STATUS_LABELS[task.status]}",
    )
    if task.status == TaskStatus.done:
        await _notify_done(db, task, actor)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def _base_query() -> Select:
    return select(Task).where(Task.deleted_at.is_(None))


async def _next_order(db: AsyncSession, target_status: TaskStatus) -> int:
    max_q = (
        select(func.max(Task.kanban_order))
        .where(Task.deleted_at.is_(None))
        .where(Task.status == target_status)
    )
    max_order = (await db.execute(max_q)).scalar()
    return (max_order + 1) if isinstance(max_order, int) else 0


async def list_tasks(
    db: AsyncSession,
    user: User,
    *,
    search: str | None = None,
    status_: TaskStatus | None = None,
    priority: Priority | None = None,
    assignee_id: uuid.UUID | None = None,
    author_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Task], int]:
    q = _base_query()
    if status_ is not None:
        q = q.where(Task.status == status_)
    if priority is not None:
        q = q.where(Task.priority == priority)
    if assignee_id is not None:
        q = q.where(Task.assignee_id == assignee_id)
    if author_id is not None:
        q = q.where(Task.author_id == author_id)
    if search:
        like = f"%{search.lower()}%"
        q = q.where(
            func.lower(Task.title).like(like)
            | func.lower(func.coalesce(Task.description, "")).like(like)
        )

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()

    q = (
        q.order_by(Task.status, Task.kanban_order, Task.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = list((await db.execute(q)).scalars().all())
    return rows, int(total)


async def get_task(db: AsyncSession, user: User, task_id: uuid.UUID) -> Task:
    task = (await db.execute(_base_query().where(Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Задача не найдена")
    return task


async def create_task(db: AsyncSession, user: User, payload: CreateTaskRequest) -> Task:
    _ensure_can_mutate(user)
    await _ensure_assignee(db, payload.assignee_id)
    now = datetime.now(timezone.utc)
    task = Task(
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        status=payload.status,
        priority=payload.priority,
        assignee_id=payload.assignee_id,
        author_id=user.id,
        due_date=payload.due_date,
        kanban_order=await _next_order(db, payload.status),
        status_changed_at=now,
        completed_at=now if payload.status == TaskStatus.done else None,
    )
    db.add(task)
    await db.flush()
    await audit_service.record_activity(
        db,
        entity_type=ActivityEntityType.task,
        entity_id=task.id,
        actor_id=user.id,
        kind=ActivityKind.create,
        text=f"Задача «{task.title}» создана",
    )
    await _notify_assigned(db, task, user)
    await db.commit()
    await db.refresh(task)
    publish_task_changed("created", id=task.id, actor_id=user.id)
    return task


async def update_task(
    db: AsyncSession, user: User, task_id: uuid.UUID, payload: UpdateTaskRequest
) -> Task:
    _ensure_can_mutate(user)
    task = await get_task(db, user, task_id)
    data = payload.model_dump(exclude_unset=True)

    if "title" in data and data["title"] is not None:
        task.title = data["title"].strip()
    if "description" in data:
        task.description = (data["description"] or "").strip() or None
    if "priority" in data and data["priority"] is not None:
        task.priority = data["priority"]
    if "due_date" in data:
        task.due_date = data["due_date"]

    if "assignee_id" in data and data["assignee_id"] != task.assignee_id:
        new_assignee = await _ensure_assignee(db, data["assignee_id"])
        task.assignee_id = data["assignee_id"]
        await audit_service.record_activity(
            db,
            entity_type=ActivityEntityType.task,
            entity_id=task.id,
            actor_id=user.id,
            kind=ActivityKind.note,
            text=(
                f"Исполнитель: {new_assignee.full_name}"
                if new_assignee is not None
                else "Исполнитель снят"
            ),
        )
        await _notify_assigned(db, task, user)

    await db.commit()
    await db.refresh(task)
    publish_task_changed("updated", id=task.id, actor_id=user.id)
    return task


async def delete_task(db: AsyncSession, user: User, task_id: uuid.UUID) -> None:
    task = await get_task(db, user, task_id)
    _ensure_can_delete(task, user)
    task.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    publish_task_changed("deleted", id=task_id, actor_id=user.id)


# ---------------------------------------------------------------------------
# Kanban: смена статуса + batch reorder
# ---------------------------------------------------------------------------


async def change_status(
    db: AsyncSession, user: User, task_id: uuid.UUID, new_status: TaskStatus
) -> Task:
    _ensure_can_mutate(user)
    task = await get_task(db, user, task_id)
    if task.status != new_status:
        before = task.status
        _apply_status(task, new_status, datetime.now(timezone.utc))
        task.kanban_order = await _next_order(db, new_status)
        await _record_status_change(db, task, user, before)
    await db.commit()
    await db.refresh(task)
    publish_task_changed("status_changed", id=task.id, actor_id=user.id)
    return task


async def reorder_kanban(db: AsyncSession, user: User, updates: list[KanbanUpdate]) -> list[Task]:
    _ensure_can_mutate(user)
    ids = [u.id for u in updates]
    if not ids:
        return []
    rows = (await db.execute(_base_query().where(Task.id.in_(ids)))).scalars().all()
    by_id = {t.id: t for t in rows}
    if len(by_id) != len(set(ids)):
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Не все задачи найдены")

    now = datetime.now(timezone.utc)
    for upd in updates:
        t = by_id[upd.id]
        if t.status != upd.status:
            before = t.status
            _apply_status(t, upd.status, now)
            await _record_status_change(db, t, user, before)
        t.kanban_order = upd.kanban_order

    await db.commit()
    publish_task_changed("reordered", ids=[t.id for t in rows], actor_id=user.id)
    return list(rows)
