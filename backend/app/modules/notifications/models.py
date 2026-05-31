"""Модель notifications.

Контракт — фронтовый `Notification` (см. `frontend/src/api/types.ts`).
`payload` хранится в JSONB на будущее (для богатых уведомлений со ссылками
и кнопками), сейчас фронт читает только `text`/`entityType`/`entityId`.

`read_at` (timestamp) вместо bool `read` — это позволяет:
* фильтровать «непрочитанные старше X дней»,
* считать аналитику по времени реакции.
Во фронт DTO маппим как `read: bool` (`read_at IS NOT NULL`).
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


class NotificationKind(str, enum.Enum):
    mention = "mention"
    status_change = "status_change"
    system = "system"
    # Добавлено миграцией 0025_notification_assignment — назначение вакансии
    # рекрутеру/ответственному (см. vacancies/service.py).
    assignment = "assignment"
    # Добавлено миграцией 0026_notification_comment — новый комментарий к
    # кандидату/вакансии для назначенного рекрутера (см. comments/service.py).
    comment = "comment"


class NotificationEntityType(str, enum.Enum):
    vacancy = "vacancy"
    candidate = "candidate"
    client = "client"
    contact = "contact"
    # Добавлено миграцией 0013_chat_read (Этап 2 чата) — для @-упоминаний
    # в сообщениях; entity_id ссылается на chat_messages.id.
    chat_message = "chat_message"
    # Добавлено миграцией 0023_calendar_events — события календаря (собесы);
    # entity_id ссылается на calendar_events.id.
    event = "event"


def _enum_values(e):
    return [m.value for m in e]


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[NotificationKind] = mapped_column(
        Enum(NotificationKind, name="notification_kind", values_callable=_enum_values),
        nullable=False,
    )
    text_: Mapped[str] = mapped_column("text", Text(), nullable=False)
    entity_type: Mapped[NotificationEntityType | None] = mapped_column(
        Enum(
            NotificationEntityType,
            name="notification_entity_type",
            values_callable=_enum_values,
        ),
        nullable=True,
    )
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()"), index=True
    )
