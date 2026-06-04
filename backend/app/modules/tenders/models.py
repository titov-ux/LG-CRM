"""SQLAlchemy-модель тендеров (госзакупки / коммерческие тендеры).

Контракт — фронтовый `Tender` (см. `frontend/src/api/types.ts`).
* `status_changed_at` обновляется в сервисе при смене status; `daysInStatus`
  считается на чтении.
* `kanban_order` — целое; тендеры в одной колонке сортируются по нему.
* `account_manager_id` — ответственный; nullable + SET NULL (паттерн миграции
  0011): удаление пользователя не сносит тендер.
* `Priority` переиспользуется из модуля vacancies — на уровне БД это тот же
  enum-тип `priority`, новый тип не создаём (см. миграцию 0031).
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


class TenderStatus(str, enum.Enum):
    lead = "lead"
    evaluation = "evaluation"
    bid = "bid"
    review = "review"
    won = "won"
    lost = "lost"


class TenderLaw(str, enum.Enum):
    """Правовой режим закупки."""

    fz44 = "fz44"
    fz223 = "fz223"
    commercial = "commercial"


def _enum_values(e):
    return [m.value for m in e]


class Tender(Base, TimestampsMixin, SoftDeleteMixin):
    __tablename__ = "tenders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    # Название закупки / тендера.
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    # Заказчик — внешняя организация (не обязательно клиент CRM), храним строкой.
    customer: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # Реестровый номер закупки (ЕИС) — опционально.
    registry_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # ЭТП (электронная торговая площадка) — свободная строка с подсказками на фронте.
    platform: Mapped[str | None] = mapped_column(String(255), nullable=True)
    law: Mapped[TenderLaw] = mapped_column(
        Enum(TenderLaw, name="tender_law", values_callable=_enum_values),
        nullable=False,
        default=TenderLaw.fz44,
    )
    # НМЦК — начальная (максимальная) цена контракта, ₽.
    nmck: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False, default=0)
    # Наша ценовая заявка, ₽ (опционально, заполняется на этапе подачи).
    our_price: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    # Обеспечение заявки, ₽ (опционально).
    security_amount: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    # Срок подачи заявки.
    submission_deadline: Mapped[date | None] = mapped_column(Date(), nullable=True)
    # Дата проведения торгов / рассмотрения заявок.
    auction_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    status: Mapped[TenderStatus] = mapped_column(
        Enum(TenderStatus, name="tender_status", values_callable=_enum_values),
        nullable=False,
        default=TenderStatus.lead,
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
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    kanban_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Ссылка на карточку закупки на ЭТП / в ЕИС.
    url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
