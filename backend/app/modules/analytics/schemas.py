"""DTO модуля analytics (зеркало `frontend/src/api/analytics.ts`)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.clients.models import ClientKind, ClientStatus
from app.modules.matching.models import MatchStatus
from app.modules.vacancies.models import VacancyStatus


CompareMode = Literal["prev", "yoy", "none"]
Granularity = Literal["auto", "day", "week", "month"]


class PeriodWindow(CamelModel):
    """Полуоткрытое окно `[from, to)` в ISO-8601 UTC.

    `from` — зарезервированное слово в Python, поэтому атрибут называется
    `from_dt`, но в JSON сериализуется как `from` (alias).
    """

    from_dt: datetime = Field(alias="from")
    to_dt: datetime = Field(alias="to")


class CompareWindow(PeriodWindow):
    mode: CompareMode


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
    period: PeriodWindow
    compare: CompareWindow | None = None


class FunnelBucket(CamelModel):
    status: VacancyStatus
    count: int


class RecruiterLoad(CamelModel):
    recruiter_id: uuid.UUID
    active_count: int


class TrendsPoint(CamelModel):
    bucket: datetime
    value: int


class TrendsSeries(CamelModel):
    vacancies_created: list[TrendsPoint]
    vacancies_closed: list[TrendsPoint]
    candidates_created: list[TrendsPoint]
    hires: list[TrendsPoint]


class TrendsResponse(CamelModel):
    granularity: Literal["day", "week", "month"]
    period: PeriodWindow
    series: TrendsSeries


# ─── Funnel v2 ───────────────────────────────────────────────────────────


class FunnelStage(CamelModel):
    status: MatchStatus
    count: int
    conversion_pct: float
    drop_off: int


class FunnelRejected(CamelModel):
    client: int
    internal: int
    total: int


class FunnelResponse(CamelModel):
    stages: list[FunnelStage]
    rejected: FunnelRejected
    total: int
    overall_conversion_pct: float
    period: PeriodWindow


# ─── Time-to-hire ────────────────────────────────────────────────────────


class TimeToHireBucket(CamelModel):
    label: str
    max_days: int | None
    count: int


class TimeInStage(CamelModel):
    status: str
    avg_days: float
    median_days: float
    sample: int


class TimeToHireResponse(CamelModel):
    sample_size: int
    avg_days: float
    median_days: float
    p90_days: float
    distribution: list[TimeToHireBucket]
    by_stage: list[TimeInStage]
    period: PeriodWindow


# ─── Attention ───────────────────────────────────────────────────────────


class AttentionVacancyItem(CamelModel):
    id: uuid.UUID
    title: str
    status: VacancyStatus | None = None
    days_in_status: int | None = None
    days_open: int | None = None
    deadline: datetime | None = None
    days_overdue: int | None = None
    days_left: int | None = None


class AttentionCandidateItem(CamelModel):
    id: uuid.UUID
    full_name: str
    status: str
    days_in_status: int


class AttentionVacancyBlock(CamelModel):
    total: int
    threshold_days: int | None = None
    items: list[AttentionVacancyItem]


class AttentionCandidateBlock(CamelModel):
    total: int
    threshold_days: int | None = None
    items: list[AttentionCandidateItem]


class AttentionCountOnly(CamelModel):
    total: int


class AttentionResponse(CamelModel):
    stuck_vacancies: AttentionVacancyBlock
    stuck_candidates: AttentionCandidateBlock
    vacancies_without_candidates: AttentionVacancyBlock
    overdue_deadlines: AttentionVacancyBlock
    deadlines_next_7_days: AttentionVacancyBlock
    deadlines_next_14_days: AttentionCountOnly


# ─── Recruiter performance ──────────────────────────────────────────────


class RecruiterMetric(CamelModel):
    recruiter_id: uuid.UUID
    full_name: str
    candidates_created: int
    presented: int
    hired: int
    hire_rate_pct: float
    avg_time_to_hire_days: float
    total_margin: float
    sparkline: list[int]


class RecruiterPerformanceResponse(CamelModel):
    items: list[RecruiterMetric]
    period: PeriodWindow


# ─── Client performance ────────────────────────────────────────────────


class ClientMetric(CamelModel):
    client_id: uuid.UUID
    name: str
    industry: str
    status: ClientStatus | None = None
    client_kind: ClientKind | None = None
    vacancies_total: int
    vacancies_open: int
    vacancies_closed_in_period: int
    hires_in_period: int
    avg_time_to_fill_days: float
    monthly_margin_run_rate: float
    presented_to_hired_pct: float
    last_vacancy_at: datetime | None = None
    days_since_last_vacancy: int | None = None
    rejection_rate_pct: float
    health_flags: list[str]
    sparkline: list[int]


class ClientPerformanceResponse(CamelModel):
    items: list[ClientMetric]
    period: PeriodWindow


# === Chat metrics (Этап 6) =================================================


class ChatStats(CamelModel):
    """Простые метрики чата — для отображения в /analytics.

    Считаются на лету без агрегирующей таблицы (объёмы маленькие).
    """

    messages_today: int
    messages_7d: int
    active_users_7d: int
    dm_count: int
    group_count: int
    avg_group_size: float
