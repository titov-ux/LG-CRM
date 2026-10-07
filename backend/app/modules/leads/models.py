"""SQLAlchemy-модель лидов (потенциальные клиенты, воронка продаж).

Контракт — фронтовый `Lead` (см. `frontend/src/api/types.ts`).
* `status_changed_at` обновляется в сервисе при смене status; `daysInStatus`
  считается на чтении.
* `kanban_order` — целое; лиды в одной колонке сортируются по нему.
* `account_manager_id` — ответственный; nullable + SET NULL (паттерн миграции
  0011): удаление пользователя не сносит лид.
* `client_id` — клиент CRM, в которого лид конвертирован (nullable, SET NULL).
* `Priority` переиспользуется из модуля vacancies — тот же enum-тип `priority`
  в БД (см. миграцию 0037).
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampsMixin

# Переиспользуем общий enum приоритета (тот же тип `priority` в БД).
from app.modules.vacancies.models import Priority


class LeadStatus(str, enum.Enum):
    new = "new"
    contacted = "contacted"
    qualified = "qualified"
    proposal = "proposal"
    negotiation = "negotiation"
    won = "won"
    lost = "lost"


def _enum_values(e):
    return [m.value for m in e]


class Lead(Base, TimestampsMixin, SoftDeleteMixin):
    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    # Суть лида / потребность: «Подбор 5 Java-разработчиков».
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    # Компания потенциального клиента (строкой — клиентом CRM она ещё не стала).
    company: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    industry: Mapped[str | None] = mapped_column(String(255), nullable=True)
    website: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Контактное лицо.
    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_position: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    telegram: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Источник лида — свободная строка с подсказками на фронте.
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Потенциальная сумма сделки, ₽.
    expected_value: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    # Дата следующего касания.
    next_contact_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    status: Mapped[LeadStatus] = mapped_column(
        Enum(LeadStatus, name="lead_status", values_callable=_enum_values),
        nullable=False,
        default=LeadStatus.new,
        index=True,
    )
    priority: Mapped[Priority] = mapped_column(
        Enum(Priority, name="priority", values_callable=_enum_values, create_type=False),
        nullable=False,
        default=Priority.medium,
    )
    account_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clients.id", ondelete="SET NULL"),
        nullable=True,
    )
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    kanban_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
