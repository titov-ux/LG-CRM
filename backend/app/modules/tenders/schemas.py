"""DTO модуля tenders (соответствует фронтовому контракту Tender)."""
from __future__ import annotations

import uuid
from datetime import date

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.tenders.models import TenderLaw, TenderStatus
from app.modules.vacancies.models import Priority


class TenderResponse(CamelModel):
    id: uuid.UUID
    title: str
    customer: str
    registry_number: str | None = None
    platform: str | None = None
    law: TenderLaw
    nmck: float
    our_price: float | None = None
    security_amount: float | None = None
    submission_deadline: date | None = None
    auction_date: date | None = None
    status: TenderStatus
    priority: Priority
    account_manager_id: uuid.UUID | None = None
    days_in_status: int
    kanban_order: int = 0
    url: str | None = None
    note: str | None = None


class CreateTenderRequest(CamelModel):
    title: str = Field(min_length=1, max_length=500)
    customer: str = Field(default="", max_length=500)
    registry_number: str | None = None
    platform: str | None = None
    law: TenderLaw = TenderLaw.fz44
    nmck: float = 0
    our_price: float | None = None
    security_amount: float | None = None
    submission_deadline: date | None = None
    auction_date: date | None = None
    status: TenderStatus = TenderStatus.lead
    priority: Priority = Priority.medium
    account_manager_id: uuid.UUID | None = None
    url: str | None = None
    note: str | None = None


class UpdateTenderRequest(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    customer: str | None = None
    registry_number: str | None = None
    platform: str | None = None
    law: TenderLaw | None = None
    nmck: float | None = None
    our_price: float | None = None
    security_amount: float | None = None
    submission_deadline: date | None = None
    auction_date: date | None = None
    priority: Priority | None = None
    account_manager_id: uuid.UUID | None = None
    url: str | None = None
    note: str | None = None
    # status — отдельно через PATCH /{id}/status (валидация переходов).


class TenderPage(CamelModel):
    items: list[TenderResponse]
    total: int
    page: int
    page_size: int


class ChangeStatusRequest(CamelModel):
    status: TenderStatus
    comment: str | None = None


class KanbanUpdate(CamelModel):
    id: uuid.UUID
    status: TenderStatus
    kanban_order: int


class KanbanOrderRequest(CamelModel):
    updates: list[KanbanUpdate]


class TransitionsResponse(CamelModel):
    transitions: dict[str, list[str]]
    final_statuses: list[str]
