"""Модели activity_log и audit_log.

`ActivityEntry` — пользовательская «история взаимодействий» (создание сущности,
смена статуса, заметка, звонок, email). Видна пользователю в карточке.

`AuditEntry` — техническая бухгалтерия: кто, что, когда поменял; before/after.
Видна только админам в /audit.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ActivityEntityType(str, enum.Enum):
    vacancy = "vacancy"
    candidate = "candidate"
    client = "client"
    tender = "tender"


class ActivityKind(str, enum.Enum):
    create = "create"
    status = "status"
    note = "note"
    call = "call"
    email = "email"


def _enum_values(e):
    return [m.value for m in e]


class ActivityEntry(Base):
    __tablename__ = "activity_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    entity_type: Mapped[ActivityEntityType] = mapped_column(
        Enum(ActivityEntityType, name="activity_entity_type", values_callable=_enum_values),
        nullable=False,
        index=True,
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # nullable=True + SET NULL: запись истории не теряется при удалении актёра.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind: Mapped[ActivityKind] = mapped_column(
        Enum(ActivityKind, name="activity_kind", values_callable=_enum_values),
        nullable=False,
    )
    text_: Mapped[str] = mapped_column("text", Text(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()"), index=True
    )


class AuditEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # nullable=True + SET NULL: запись аудита переживает удаление актёра.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    field: Mapped[str] = mapped_column(String(64), nullable=False)
    before: Mapped[str | None] = mapped_column(Text(), nullable=True)
    after: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()"), index=True
    )
