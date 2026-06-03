"""DTO модуля notifications."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from app.core.schemas import CamelModel
from app.modules.notifications.models import NotificationEntityType, NotificationKind


class NotificationResponse(CamelModel):
    id: uuid.UUID
    user_id: uuid.UUID
    kind: NotificationKind
    text: str
    entity_type: NotificationEntityType | None = None
    entity_id: uuid.UUID | None = None
    # Доп. данные для построения ссылки-перехода. Например, у chat_message
    # entity_id указывает на сообщение, а перейти нужно в диалог — его id лежит
    # в payload.conversationId.
    payload: dict[str, Any] = {}
    read: bool
    created_at: datetime
