"""DTO модуля tasks (соответствует фронтовому контракту Task)."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.tasks.models import TaskStatus
from app.modules.vacancies.models import Priority


class TaskResponse(CamelModel):
    id: uuid.UUID
    title: str
    description: str | None = None
    status: TaskStatus
    priority: Priority
    assignee_id: uuid.UUID | None = None
    author_id: uuid.UUID | None = None
    due_date: date | None = None
    days_in_status: int
    completed_at: datetime | None = None
    created_at: datetime
    kanban_order: int = 0


class CreateTaskRequest(CamelModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=20_000)
    status: TaskStatus = TaskStatus.todo
    priority: Priority = Priority.medium
    assignee_id: uuid.UUID | None = None
    due_date: date | None = None


class UpdateTaskRequest(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=20_000)
    priority: Priority | None = None
    assignee_id: uuid.UUID | None = None
    due_date: date | None = None
    # status — отдельно через PATCH /{id}/status или PUT /kanban-order.


class TaskPage(CamelModel):
    items: list[TaskResponse]
    total: int
    page: int
    page_size: int


class ChangeStatusRequest(CamelModel):
    status: TaskStatus


class KanbanUpdate(CamelModel):
    id: uuid.UUID
    status: TaskStatus
    kanban_order: int


class KanbanOrderRequest(CamelModel):
    updates: list[KanbanUpdate]
