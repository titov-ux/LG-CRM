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
    actor_id: uuid.UUID
    kind: ActivityKind
    text: str
    created_at: datetime


class AuditResponse(CamelModel):
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    actor_id: uuid.UUID
    field: str
    before: str | None = None
    after: str | None = None
    created_at: datetime
