"""Эндпоинты audit/activity.

* `GET /audit` — общий журнал, только admin (право `audit.view` стоит на нём
  в матрице).
* `GET /vacancies/{id}/activity`, `/candidates/{id}/activity`,
  `/clients/{id}/activity` — публикуются в роутерах соответствующих модулей,
  но логика лежит здесь же (через `audit_service.list_activity`).
"""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.audit.models import ActivityEntityType
from app.modules.audit.schemas import ActivityResponse, AuditResponse
from app.modules.auth.dependencies import get_current_user, require_roles
from app.modules.users.models import Role, User

router = APIRouter(prefix="/audit", tags=["audit"])


def _activity_to_dto(a) -> ActivityResponse:
    return ActivityResponse(
        id=a.id,
        entity_type=a.entity_type,
        entity_id=a.entity_id,
        actor_id=a.actor_id,
        kind=a.kind,
        text=a.text_,
        created_at=a.created_at,
    )


def _audit_to_dto(a) -> AuditResponse:
    return AuditResponse.model_validate(a)


@router.get("", response_model=list[AuditResponse], summary="Журнал аудита с фильтрами")
async def list_audit(
    entity_type: str | None = Query(default=None, alias="entityType"),
    entity_id: uuid.UUID | None = Query(default=None, alias="entityId"),
    actor_id: uuid.UUID | None = Query(default=None, alias="actorId"),
    field: str | None = None,
    date_from: date | None = Query(default=None, alias="dateFrom"),
    date_to: date | None = Query(default=None, alias="dateTo"),
    search: str | None = None,
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> list[AuditResponse]:
    rows = await audit_service.list_audit(
        db,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
        field=field,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )
    return [_audit_to_dto(a) for a in rows]


# --- Хелперы для роутеров vacancies/candidates/clients ---


async def _activity_for(
    db: AsyncSession, entity_type: ActivityEntityType, entity_id: uuid.UUID
) -> list[ActivityResponse]:
    rows = await audit_service.list_activity(db, entity_type, entity_id)
    return [_activity_to_dto(a) for a in rows]


# Вторичные роутеры, подключаемые отдельно. Так мы избегаем кругового импорта
# в файлах vacancies/candidates/clients.
activity_router = APIRouter(tags=["audit"])


@activity_router.get(
    "/vacancies/{entity_id}/activity",
    response_model=list[ActivityResponse],
    summary="Активность по вакансии",
)
async def vacancy_activity(
    entity_id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ActivityResponse]:
    return await _activity_for(db, ActivityEntityType.vacancy, entity_id)


@activity_router.get(
    "/candidates/{entity_id}/activity",
    response_model=list[ActivityResponse],
    summary="Активность по кандидату",
)
async def candidate_activity(
    entity_id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ActivityResponse]:
    return await _activity_for(db, ActivityEntityType.candidate, entity_id)


@activity_router.get(
    "/clients/{entity_id}/activity",
    response_model=list[ActivityResponse],
    summary="Активность по клиенту",
)
async def client_activity(
    entity_id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ActivityResponse]:
    return await _activity_for(db, ActivityEntityType.client, entity_id)
