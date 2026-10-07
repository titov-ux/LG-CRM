"""Эндпоинты /leads (+ kanban-операции + transitions)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.leads import service, transitions
from app.modules.leads.models import Lead as LeadModel, LeadStatus
from app.modules.leads.schemas import (
    ChangeStatusRequest,
    CreateLeadRequest,
    KanbanOrderRequest,
    LeadPage,
    LeadResponse,
    TransitionsResponse,
    UpdateLeadRequest,
)
from app.modules.users.models import User
from app.modules.vacancies.models import Priority

router = APIRouter(prefix="/leads", tags=["leads"])


def _to_dto(lead: LeadModel) -> LeadResponse:
    return LeadResponse(
        id=lead.id,
        title=lead.title,
        company=lead.company or "",
        industry=lead.industry,
        website=lead.website,
        contact_name=lead.contact_name,
        contact_position=lead.contact_position,
        phone=lead.phone,
        email=lead.email,
        telegram=lead.telegram,
        source=lead.source,
        expected_value=float(lead.expected_value) if lead.expected_value is not None else None,
        next_contact_date=lead.next_contact_date,
        status=lead.status,
        priority=lead.priority,
        account_manager_id=lead.account_manager_id,
        client_id=lead.client_id,
        days_in_status=service.days_in_status(lead),
        kanban_order=lead.kanban_order,
        note=lead.note,
    )


# --- порядок важен: /transitions и /kanban-order должны быть выше /{id} ----


@router.get("/transitions", response_model=TransitionsResponse, summary="Карта переходов статусов")
async def get_transitions(
    _: User = Depends(get_current_user),
) -> TransitionsResponse:
    return TransitionsResponse(
        transitions=transitions.as_dict(),
        final_statuses=sorted(s.value for s in transitions.FINAL_STATUSES),
    )


@router.put(
    "/kanban-order",
    response_model=list[LeadResponse],
    summary="Пакетное обновление порядка карточек",
)
async def reorder_kanban(
    payload: KanbanOrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[LeadResponse]:
    rows = await service.reorder_kanban(db, user, payload.updates)
    return [_to_dto(t) for t in rows]


@router.get("", response_model=LeadPage, summary="Список лидов с фильтрами")
async def list_leads(
    search: str | None = None,
    status_: LeadStatus | None = Query(default=None, alias="status"),
    priority: Priority | None = None,
    source: str | None = None,
    account_manager_id: uuid.UUID | None = Query(default=None, alias="accountManagerId"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LeadPage:
    rows, total = await service.list_leads(
        db,
        user,
        search=search,
        status_=status_,
        priority=priority,
        source=source,
        account_manager_id=account_manager_id,
        page=page,
        page_size=page_size,
    )
    return LeadPage(items=[_to_dto(t) for t in rows], total=total, page=page, page_size=page_size)


@router.post(
    "",
    response_model=LeadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать лид",
)
async def create_lead(
    payload: CreateLeadRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LeadResponse:
    lead = await service.create_lead(db, user, payload)
    return _to_dto(lead)


@router.get("/{lead_id}", response_model=LeadResponse, summary="Лид по id")
async def get_lead(
    lead_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LeadResponse:
    lead = await service.get_lead(db, user, lead_id)
    return _to_dto(lead)


@router.patch("/{lead_id}", response_model=LeadResponse, summary="Обновить лид")
async def update_lead(
    lead_id: uuid.UUID,
    payload: UpdateLeadRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LeadResponse:
    lead = await service.update_lead(db, user, lead_id, payload)
    return _to_dto(lead)


@router.delete("/{lead_id}", response_model=OkResponse, summary="Удалить лид (soft)")
async def delete_lead(
    lead_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_lead(db, user, lead_id)
    return OkResponse()


@router.patch("/{lead_id}/status", response_model=LeadResponse, summary="Сменить статус лида")
async def change_status(
    lead_id: uuid.UUID,
    payload: ChangeStatusRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LeadResponse:
    lead = await service.change_status(db, user, lead_id, payload)
    return _to_dto(lead)
