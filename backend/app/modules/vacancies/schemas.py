"""DTO модуля vacancies (соответствует фронтовому контракту Vacancy)."""
from __future__ import annotations

import uuid
from datetime import date

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.vacancies.models import (
    EngagementType,
    Grade,
    Priority,
    VacancyStatus,
    WorkFormat,
)


class VacancyResponse(CamelModel):
    id: uuid.UUID
    title: str
    client_id: uuid.UUID
    engagement_type: EngagementType
    project: str | None = None
    grade: Grade
    stack: list[str] = Field(default_factory=list)
    format: WorkFormat
    rate_client: float
    salary_max: float | None = None
    positions: int
    status: VacancyStatus
    priority: Priority
    # nullable: если пользователь удалён, AM сбрасывается в null (см. миграцию 0011).
    account_manager_id: uuid.UUID | None = None
    recruiter_ids: list[uuid.UUID] = Field(default_factory=list)
    days_in_status: int
    candidates_count: int = 0
    deadline: date | None = None
    kanban_order: int = 0
    description: str | None = None
    requirements: str | None = None


class CreateVacancyRequest(CamelModel):
    title: str = Field(min_length=1)
    client_id: uuid.UUID
    engagement_type: EngagementType = EngagementType.outstaff
    project: str | None = None
    grade: Grade = Grade.middle
    stack: list[str] = Field(default_factory=list)
    format: WorkFormat = WorkFormat.hybrid
    rate_client: float = 0
    salary_max: float | None = None
    positions: int = Field(default=1, ge=1)
    status: VacancyStatus = VacancyStatus.new
    priority: Priority = Priority.medium
    # AM можно не указывать при создании — тогда вакансия будет «без ответственного».
    account_manager_id: uuid.UUID | None = None
    recruiter_ids: list[uuid.UUID] = Field(default_factory=list)
    deadline: date | None = None
    description: str | None = None
    requirements: str | None = None


class UpdateVacancyRequest(CamelModel):
    title: str | None = None
    client_id: uuid.UUID | None = None
    engagement_type: EngagementType | None = None
    project: str | None = None
    grade: Grade | None = None
    stack: list[str] | None = None
    format: WorkFormat | None = None
    rate_client: float | None = None
    salary_max: float | None = None
    positions: int | None = Field(default=None, ge=1)
    priority: Priority | None = None
    account_manager_id: uuid.UUID | None = None
    recruiter_ids: list[uuid.UUID] | None = None
    deadline: date | None = None
    description: str | None = None
    requirements: str | None = None
    # status — отдельно через PATCH /{id}/status (валидация переходов).


class VacancyPage(CamelModel):
    items: list[VacancyResponse]
    total: int
    page: int
    page_size: int


class ChangeStatusRequest(CamelModel):
    status: VacancyStatus
    comment: str | None = None


class KanbanUpdate(CamelModel):
    id: uuid.UUID
    status: VacancyStatus
    kanban_order: int


class KanbanOrderRequest(CamelModel):
    updates: list[KanbanUpdate]


class TransitionsResponse(CamelModel):
    """Карта разрешённых переходов: { 'new': ['in_work','paused'], … }."""

    transitions: dict[str, list[str]]
    final_statuses: list[str]


# ────────────────────────────────────────────────────────────────────────────
# AI-распознавание брифа вакансии
# ────────────────────────────────────────────────────────────────────────────


class ParseVacancyTextRequest(CamelModel):
    text: str = Field(min_length=1, max_length=50_000)


class ParsedVacancy(CamelModel):
    """Структурированный результат распознавания (все поля опциональны)."""

    title: str | None = None
    project: str | None = None
    grade: Grade | None = None
    format: WorkFormat | None = None
    priority: Priority | None = None
    rate_client: float | None = None
    deadline: date | None = None
    stack: str | None = None  # CSV
    description: str | None = None
    requirements: str | None = None


class ParseVacancyTextResponse(CamelModel):
    parsed: ParsedVacancy
