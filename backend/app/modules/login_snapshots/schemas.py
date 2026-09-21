"""DTO модуля login_snapshots (camelCase контракт с фронтом)."""
from __future__ import annotations

import uuid
from datetime import datetime

from app.core.schemas import CamelModel
from app.modules.login_snapshots.models import SnapshotStatus


class LoginSnapshotResponse(CamelModel):
    """Ответ на регистрацию снимка (фронту достаточно id и статуса)."""

    id: uuid.UUID
    status: SnapshotStatus
    created_at: datetime


class LoginSnapshotItem(CamelModel):
    """Строка журнала для админ-просмотра.

    `image_url` — presigned GET в S3 с коротким TTL; NULL, если кадра нет
    (камера была запрещена/недоступна) — тогда смотрим только на `status`.
    """

    id: uuid.UUID
    user_id: uuid.UUID | None = None
    user_full_name: str | None = None
    user_email: str | None = None
    status: SnapshotStatus
    image_url: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    created_at: datetime
