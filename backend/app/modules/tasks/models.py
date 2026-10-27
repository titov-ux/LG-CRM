"""SQLAlchemy-модель задач (внутренняя доска задач команды).

Контракт — фронтовый `Task` (см. `frontend/src/api/types.ts`).
* `status_changed_at` обновляется в сервисе при смене status; `daysInStatus`
  считается на чтении.
* `completed_at` проставляется при переводе в `done` и сбрасывается при
  возврате из него.
* `kanban_order` — целое; задачи в одной колонке сортируются по нему.
* `assignee_id` / `author_id` — nullable + SET NULL (паттерн миграции 0011):
  удаление пользователя не сносит задачу.
* `Priority` переиспользуется из модуля vacancies — на уровне БД это тот же
  enum-тип `priority`, новый тип не создаём (см. миграцию 0042).
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampsMixin
# Переиспользуем общий enum приоритета (тот же тип `priority` в БД).
from app.modules.vacancies.models import Priority


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    review = "review"
    done = "done"


def _enum_values(e):
    return [m.value for m in e]


class Task(Base, TimestampsMixin, SoftDeleteMixin):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status", values_callable=_enum_values),
        nullable=False,
        default=TaskStatus.todo,
        index=True,
    )
    priority: Mapped[Priority] = mapped_column(
        Enum(Priority, name="priority", values_callable=_enum_values, create_type=False),
        nullable=False,
        default=Priority.medium,
    )
    # Исполнитель.
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Постановщик (кто создал задачу).
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Срок выполнения.
    due_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    kanban_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
