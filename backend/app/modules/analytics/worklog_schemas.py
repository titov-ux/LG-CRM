"""DTO для /analytics/worklog/* (зеркало фронтовых типов)."""
from __future__ import annotations

import uuid
from datetime import datetime

from app.core.schemas import CamelModel
from app.modules.analytics.worklog_models import WorkSessionEndReason


class WorklogUserSummary(CamelModel):
    """Суммарное время одного сотрудника за период."""

    user_id: uuid.UUID
    full_name: str
    total_seconds: int
    # Активное время (вкладка видима + взаимодействие), пропорционально окну.
    total_active_seconds: int = 0
    sessions_count: int


class WorklogSummaryResponse(CamelModel):
    from_dt: datetime
    to_dt: datetime
    items: list[WorklogUserSummary]


class WorklogSession(CamelModel):
    """Сырой интервал «онлайн» (для детального просмотра/аудита)."""

    id: uuid.UUID
    user_id: uuid.UUID | None
    started_at: datetime
    last_heartbeat_at: datetime
    ended_at: datetime | None
    end_reason: WorkSessionEndReason | None
    duration_seconds: int | None
