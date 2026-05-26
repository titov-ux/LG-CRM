"""SQLAlchemy-модели клиентов, юр.лиц и контактов.

Структура соответствует фронтовому контракту `Client` / `LegalEntity` /
`Contact` (см. `frontend/src/api/types.ts`).

* `clients.client_kind` — direct (прямой клиент) или intermediary (посредник):
  поле бизнес-критичное (маржинальность, юридическая цепочка), поэтому хранится
  отдельно от воронки `status`.
* `legal_entities` — n-арное отношение к клиенту (у клиента может быть несколько
  юр.лиц с разными ИНН).
* `vacanciesCount` / `contactsCount` — производные счётчики, не храним в БД,
  считаем на чтении (как делает MSW). Денормализация — по необходимости на
  Этапе 4 (когда появятся вакансии и нагрузка вырастет).
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampsMixin


class ClientStatus(str, enum.Enum):
    lead = "lead"
    in_progress = "in_progress"
    active = "active"
    paused = "paused"
    archived = "archived"


class ClientKind(str, enum.Enum):
    direct = "direct"
    intermediary = "intermediary"


def _enum_values(e):
    return [m.value for m in e]


class Client(Base, TimestampsMixin, SoftDeleteMixin):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    industry: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # nullable=True + SET NULL: при удалении пользователя AM сбрасывается в пустое
    # значение, клиент не удаляется. См. миграцию 0011_user_fk_set_null.
    account_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[ClientStatus] = mapped_column(
        Enum(ClientStatus, name="client_status", values_callable=_enum_values),
        nullable=False,
        default=ClientStatus.lead,
        index=True,
    )
    client_kind: Mapped[ClientKind] = mapped_column(
        Enum(ClientKind, name="client_kind", values_callable=_enum_values),
        nullable=False,
        default=ClientKind.direct,
        index=True,
    )
    telegram_chat: Mapped[str | None] = mapped_column(String(255), nullable=True)

    legal_entities: Mapped[list["LegalEntity"]] = relationship(
        back_populates="client",
        cascade="all, delete-orphan",
        order_by="LegalEntity.created_at",
        lazy="selectin",
    )
    contacts: Mapped[list["Contact"]] = relationship(
        back_populates="client",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class LegalEntity(Base, TimestampsMixin):
    __tablename__ = "legal_entities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    inn: Mapped[str] = mapped_column(String(32), nullable=False)

    client: Mapped[Client] = relationship(back_populates="legal_entities")


class Contact(Base, TimestampsMixin, SoftDeleteMixin):
    __tablename__ = "contacts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    telegram: Mapped[str | None] = mapped_column(String(255), nullable=True)
    birthday: Mapped[date | None] = mapped_column(Date(), nullable=True)

    client: Mapped[Client] = relationship(back_populates="contacts")
