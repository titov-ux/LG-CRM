"""DTO модуля leads (соответствует фронтовому контракту Lead)."""
from __future__ import annotations

import uuid
from datetime import date

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.leads.models import LeadStatus
from app.modules.vacancies.models import Priority


class LeadResponse(CamelModel):
    id: uuid.UUID
    title: str
    company: str
    industry: str | None = None
    website: str | None = None
    contact_name: str | None = None
    contact_position: str | None = None
    phone: str | None = None
    email: str | None = None
    telegram: str | None = None
    source: str | None = None
    expected_value: float | None = None
    next_contact_date: date | None = None
    status: LeadStatus
    priority: Priority
    account_manager_id: uuid.UUID | None = None
    client_id: uuid.UUID | None = None
    days_in_status: int
    kanban_order: int = 0
    note: str | None = None


class CreateLeadRequest(CamelModel):
    title: str = Field(min_length=1, max_length=500)
    company: str = Field(default="", max_length=500)
    industry: str | None = Field(default=None, max_length=255)
    website: str | None = Field(default=None, max_length=1000)
    contact_name: str | None = Field(default=None, max_length=255)
    contact_position: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=255)
    telegram: str | None = Field(default=None, max_length=255)
    source: str | None = Field(default=None, max_length=255)
    expected_value: float | None = Field(default=None, ge=0)
    next_contact_date: date | None = None
    status: LeadStatus = LeadStatus.new
    priority: Priority = Priority.medium
    account_manager_id: uuid.UUID | None = None
    note: str | None = None


class UpdateLeadRequest(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    company: str | None = Field(default=None, max_length=500)
    industry: str | None = Field(default=None, max_length=255)
    website: str | None = Field(default=None, max_length=1000)
    contact_name: str | None = Field(default=None, max_length=255)
    contact_position: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=255)
    telegram: str | None = Field(default=None, max_length=255)
    source: str | None = Field(default=None, max_length=255)
    expected_value: float | None = Field(default=None, ge=0)
    next_contact_date: date | None = None
    priority: Priority | None = None
    account_manager_id: uuid.UUID | None = None
    client_id: uuid.UUID | None = None
    note: str | None = None
    # status — отдельно через PATCH /{id}/status (валидация переходов).


class LeadPage(CamelModel):
    items: list[LeadResponse]
    total: int
    page: int
    page_size: int


class ChangeStatusRequest(CamelModel):
    status: LeadStatus
    comment: str | None = None


class KanbanUpdate(CamelModel):
    id: uuid.UUID
    status: LeadStatus
    kanban_order: int


class KanbanOrderRequest(CamelModel):
    updates: list[KanbanUpdate]


class TransitionsResponse(CamelModel):
    transitions: dict[str, list[str]]
    final_statuses: list[str]
