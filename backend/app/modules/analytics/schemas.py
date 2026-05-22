"""DTO модуля analytics (зеркало `frontend/src/api/analytics.ts`)."""
from __future__ import annotations

import uuid

from app.core.schemas import CamelModel
from app.modules.vacancies.models import VacancyStatus


class SummaryDelta(CamelModel):
    open_vacancies: float = 0
    active_candidates: float = 0
    closed_this_month: float = 0
    hired_this_month: float = 0


class DashboardSummary(CamelModel):
    open_vacancies: int
    active_candidates: int
    closed_this_month: int
    hired_this_month: int
    delta: SummaryDelta


class FunnelBucket(CamelModel):
    status: VacancyStatus
    count: int


class RecruiterLoad(CamelModel):
    recruiter_id: uuid.UUID
    active_count: int
