"""Эндпоинты /tenders (+ kanban-операции + transitions)."""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.tenders import service, transitions
from app.modules.tenders.models import Tender as TenderModel, TenderLaw, TenderStatus
from app.modules.tenders.schemas import (
    ChangeStatusRequest,
    CreateTenderRequest,
    KanbanOrderRequest,
    TenderPage,
    TenderResponse,
    TransitionsResponse,
    UpdateTenderRequest,
)
from app.modules.users.models import User
from app.modules.vacancies.models import Priority

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenders", tags=["tenders"])


def _to_dto(tender: TenderModel) -> TenderResponse:
    return TenderResponse(
        id=tender.id,
        title=tender.title,
        customer=tender.customer or "",
        registry_number=tender.registry_number,
        platform=tender.platform,
        law=tender.law,
        nmck=float(tender.nmck or 0),
        our_price=float(tender.our_price) if tender.our_price is not None else None,
        security_amount=(
            float(tender.security_amount) if tender.security_amount is not None else None
        ),
        submission_deadline=tender.submission_deadline,
        auction_date=tender.auction_date,
        status=tender.status,
        priority=tender.priority,
        account_manager_id=tender.account_manager_id,
        days_in_status=service.days_in_status(tender),
        kanban_order=tender.kanban_order,
        url=tender.url,
        note=tender.note,
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
    response_model=list[TenderResponse],
    summary="Пакетное обновление порядка карточек",
)
async def reorder_kanban(
    payload: KanbanOrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TenderResponse]:
    rows = await service.reorder_kanban(db, user, payload.updates)
    return [_to_dto(t) for t in rows]


@router.get("", response_model=TenderPage, summary="Список тендеров с фильтрами")
async def list_tenders(
    search: str | None = None,
    status_: TenderStatus | None = Query(default=None, alias="status"),
    law: TenderLaw | None = None,
    priority: Priority | None = None,
    platform: str | None = None,
    account_manager_id: uuid.UUID | None = Query(default=None, alias="accountManagerId"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenderPage:
    rows, total = await service.list_tenders(
        db,
        user,
        search=search,
        status_=status_,
        law=law,
        priority=priority,
        platform=platform,
        account_manager_id=account_manager_id,
        page=page,
        page_size=page_size,
    )
    return TenderPage(
        items=[_to_dto(t) for t in rows], total=total, page=page, page_size=page_size
    )


@router.post(
    "",
    response_model=TenderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать тендер",
)
async def create_tender(
    payload: CreateTenderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenderResponse:
    tender = await service.create_tender(db, user, payload)
    return _to_dto(tender)


@router.get("/{tender_id}", response_model=TenderResponse, summary="Тендер по id")
async def get_tender(
    tender_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenderResponse:
    tender = await service.get_tender(db, user, tender_id)
    return _to_dto(tender)


@router.patch("/{tender_id}", response_model=TenderResponse, summary="Обновить тендер")
async def update_tender(
    tender_id: uuid.UUID,
    payload: UpdateTenderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenderResponse:
    tender = await service.update_tender(db, user, tender_id, payload)
    return _to_dto(tender)


@router.delete("/{tender_id}", response_model=OkResponse, summary="Удалить тендер (soft)")
async def delete_tender(
    tender_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_tender(db, user, tender_id)
    return OkResponse()


@router.patch(
    "/{tender_id}/status",
    response_model=TenderResponse,
    summary="Сменить статус тендера",
)
async def change_status(
    tender_id: uuid.UUID,
    payload: ChangeStatusRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenderResponse:
    tender = await service.change_status(db, user, tender_id, payload)
    return _to_dto(tender)
