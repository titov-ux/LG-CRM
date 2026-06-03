"""Эндпоинты /notifications."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.notifications import service
from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import NotificationResponse
from app.modules.users.models import User

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _to_dto(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=n.id,
        user_id=n.user_id,
        kind=n.kind,
        text=n.text_,
        entity_type=n.entity_type,
        entity_id=n.entity_id,
        payload=n.payload or {},
        read=n.read_at is not None,
        created_at=n.created_at,
    )


@router.get("", response_model=list[NotificationResponse], summary="Уведомления пользователя")
async def list_notifications(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[NotificationResponse]:
    rows = await service.list_for_user(db, user.id)
    return [_to_dto(n) for n in rows]


@router.patch(
    "/{notification_id}/read",
    response_model=NotificationResponse,
    summary="Отметить уведомление прочитанным",
)
async def mark_read(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationResponse:
    n = await service.mark_read(db, user.id, notification_id)
    return _to_dto(n)


@router.post("/read-all", response_model=OkResponse, summary="Отметить все прочитанными")
async def mark_all_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.mark_all_read(db, user.id)
    return OkResponse()
