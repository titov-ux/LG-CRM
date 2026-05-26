"""DTO модулей activity и audit."""
from __future__ import annotations

import uuid
from datetime import datetime

from app.core.schemas import CamelModel
from app.modules.audit.models import ActivityEntityType, ActivityKind


class ActivityResponse(CamelModel):
    id: uuid.UUID
    entity_type: ActivityEntityType
    entity_id: uuid.UUID
    # actor_id может быть null, если автор записи удалён (см. миграцию 0011).
    actor_id: uuid.UUID | None = None
    kind: ActivityKind
    text: str
    created_at: datetime


class AuditResponse(CamelModel):
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    # actor_id может быть null, если автор записи удалён (см. миграцию 0011).
    actor_id: uuid.UUID | None = None
    field: str
    before: str | None = None
    after: str | None = None
    created_at: datetime
