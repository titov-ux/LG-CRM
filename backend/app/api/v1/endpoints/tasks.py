"""Эндпоинты /tasks (доска задач команды + kanban-операции)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.tasks import service
from app.modules.tasks.models import Task as TaskModel
from app.modules.tasks.models import TaskStatus
from app.modules.tasks.schemas import (
    ChangeStatusRequest,
    CreateTaskRequest,
    KanbanOrderRequest,
    TaskPage,
    TaskResponse,
    UpdateTaskRequest,
)
from app.modules.users.models import User
from app.modules.vacancies.models import Priority

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _to_dto(task: TaskModel) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        assignee_id=task.assignee_id,
        author_id=task.author_id,
        due_date=task.due_date,
        days_in_status=service.days_in_status(task),
        completed_at=task.completed_at,
        created_at=task.created_at,
        kanban_order=task.kanban_order,
    )


# --- порядок важен: /kanban-order должен быть выше /{id} ---------------------


@router.put(
    "/kanban-order",
    response_model=list[TaskResponse],
    summary="Пакетное обновление порядка карточек",
)
async def reorder_kanban(
    payload: KanbanOrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TaskResponse]:
    rows = await service.reorder_kanban(db, user, payload.updates)
    return [_to_dto(t) for t in rows]


@router.get("", response_model=TaskPage, summary="Список задач с фильтрами")
async def list_tasks(
    search: str | None = None,
    status_: TaskStatus | None = Query(default=None, alias="status"),
    priority: Priority | None = None,
    assignee_id: uuid.UUID | None = Query(default=None, alias="assigneeId"),
    author_id: uuid.UUID | None = Query(default=None, alias="authorId"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500, alias="pageSize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskPage:
    rows, total = await service.list_tasks(
        db,
        user,
        search=search,
        status_=status_,
        priority=priority,
        assignee_id=assignee_id,
        author_id=author_id,
        page=page,
        page_size=page_size,
    )
    return TaskPage(items=[_to_dto(t) for t in rows], total=total, page=page, page_size=page_size)


@router.post(
    "",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать задачу",
)
async def create_task(
    payload: CreateTaskRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = await service.create_task(db, user, payload)
    return _to_dto(task)


@router.get("/{task_id}", response_model=TaskResponse, summary="Задача по id")
async def get_task(
    task_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = await service.get_task(db, user, task_id)
    return _to_dto(task)


@router.patch("/{task_id}", response_model=TaskResponse, summary="Обновить задачу")
async def update_task(
    task_id: uuid.UUID,
    payload: UpdateTaskRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = await service.update_task(db, user, task_id, payload)
    return _to_dto(task)


@router.delete("/{task_id}", response_model=OkResponse, summary="Удалить задачу (soft)")
async def delete_task(
    task_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_task(db, user, task_id)
    return OkResponse()


@router.patch("/{task_id}/status", response_model=TaskResponse, summary="Сменить статус задачи")
async def change_status(
    task_id: uuid.UUID,
    payload: ChangeStatusRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = await service.change_status(db, user, task_id, payload.status)
    return _to_dto(task)
