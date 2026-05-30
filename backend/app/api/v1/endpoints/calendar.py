"""Эндпоинты календаря: /calendar/events."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.calendar import service
from app.modules.calendar.models import EventStatus, EventType
from app.modules.calendar.schemas import (
    CalendarEventResponse,
    CancelRequest,
    CreateEventRequest,
    OutcomeRequest,
    UpdateEventRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get(
    "/events",
    response_model=list[CalendarEventResponse],
    summary="События в диапазоне дат",
)
async def list_events(
    from_dt: datetime = Query(..., alias="from"),
    to_dt: datetime = Query(..., alias="to"),
    recruiter_id: uuid.UUID | None = Query(None, alias="recruiterId"),
    vacancy_id: uuid.UUID | None = Query(None, alias="vacancyId"),
    candidate_id: uuid.UUID | None = Query(None, alias="candidateId"),
    status_filter: EventStatus | None = Query(None, alias="status"),
    type_filter: EventType | None = Query(None, alias="type"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CalendarEventResponse]:
    return await service.list_range(
        db,
        user,
        from_dt=from_dt,
        to_dt=to_dt,
        recruiter_id=recruiter_id,
        vacancy_id=vacancy_id,
        candidate_id=candidate_id,
        status_filter=status_filter,
        type_filter=type_filter,
    )


@router.post(
    "/events",
    response_model=CalendarEventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать событие (собеседование)",
)
async def create_event(
    payload: CreateEventRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    return await service.create(db, user, payload)


@router.get(
    "/events/{event_id}",
    response_model=CalendarEventResponse,
    summary="Получить событие",
)
async def get_event(
    event_id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    return await service.get(db, event_id)


@router.patch(
    "/events/{event_id}",
    response_model=CalendarEventResponse,
    summary="Обновить / перенести событие",
)
async def update_event(
    event_id: uuid.UUID,
    payload: UpdateEventRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    return await service.update(db, user, event_id, payload)


@router.post(
    "/events/{event_id}/outcome",
    response_model=CalendarEventResponse,
    summary="Отметить исход (состоялось / не пришёл)",
)
async def set_outcome(
    event_id: uuid.UUID,
    payload: OutcomeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    return await service.set_outcome(db, user, event_id, payload)


@router.post(
    "/events/{event_id}/cancel",
    response_model=CalendarEventResponse,
    summary="Отменить событие",
)
async def cancel_event(
    event_id: uuid.UUID,
    payload: CancelRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    return await service.cancel(db, user, event_id, payload.reason)


@router.delete(
    "/events/{event_id}",
    response_model=OkResponse,
    summary="Удалить событие",
)
async def delete_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete(db, user, event_id)
    return OkResponse()
