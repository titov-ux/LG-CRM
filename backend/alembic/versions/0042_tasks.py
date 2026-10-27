"""tasks: доска задач команды

Revision ID: 0042_tasks
Revises: 0041_vacancy_candidate_view
Create Date: 2026-10-27

Таблица задач с канбан-статусами (todo → in_progress → review → done),
исполнителем, постановщиком и сроком. Приоритет переиспользует существующий
enum `priority` (create_type=False — не пересоздаём тип).

FK на users.id — SET NULL + nullable (паттерн миграции 0011): удаление
пользователя не блокируется и не сносит задачу.

Также добавляет значение 'task' в enum'ы activity/comment/notification —
история, комментарии и уведомления на карточке задачи. ALTER TYPE … ADD VALUE
идёт вне транзакции (autocommit_block, как в 0032/0037); downgrade эти значения
не удаляет — PostgreSQL так не умеет.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0042_tasks"
down_revision: str | Sequence[str] | None = "0041_vacancy_candidate_view"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TASK_STATUS = ("todo", "in_progress", "review", "done")


def upgrade() -> None:
    postgresql.ENUM(*TASK_STATUS, name="task_status", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "tasks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(*TASK_STATUS, name="task_status", create_type=False),
            nullable=False,
            server_default="todo",
        ),
        sa.Column(
            "priority",
            # Переиспользуем существующий enum `priority` — НЕ создаём заново.
            postgresql.ENUM("low", "medium", "high", "urgent", name="priority", create_type=False),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "assignee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column(
            "status_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("kanban_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_assignee_id", "tasks", ["assignee_id"])
    op.create_index("ix_tasks_author_id", "tasks", ["author_id"])
    op.create_index("ix_tasks_deleted_at", "tasks", ["deleted_at"])

    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE activity_entity_type ADD VALUE IF NOT EXISTS 'task'")
        op.execute("ALTER TYPE comment_entity_type ADD VALUE IF NOT EXISTS 'task'")
        op.execute("ALTER TYPE notification_entity_type ADD VALUE IF NOT EXISTS 'task'")


def downgrade() -> None:
    op.drop_index("ix_tasks_deleted_at", table_name="tasks")
    op.drop_index("ix_tasks_author_id", table_name="tasks")
    op.drop_index("ix_tasks_assignee_id", table_name="tasks")
    op.drop_index("ix_tasks_status", table_name="tasks")
    op.drop_table("tasks")
    postgresql.ENUM(name="task_status").drop(op.get_bind(), checkfirst=True)
