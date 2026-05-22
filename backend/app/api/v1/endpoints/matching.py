"""Эндпоинты matching: /vacancies/{id}/candidates и /matches/{id}."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.matching import service
from app.modules.matching.schemas import (
    AttachRequest,
    UpdateMatchRequest,
    VacancyCandidateResponse,
)
from app.modules.users.models import User

# Этот роутер крепится по разным префиксам:
#   * /vacancies/{id}/candidates — пристёгнут к роутеру vacancies (см. ниже)
#   * /matches/{match_id} — отдельный роутер
matches_router = APIRouter(prefix="/matches", tags=["matching"])
vacancy_matches_router = APIRouter(prefix="/vacancies/{vacancy_id}/candidates", tags=["matching"])


def _to_dto(m) -> VacancyCandidateResponse:
    return VacancyCandidateResponse.model_validate(m)


@vacancy_matches_router.get(
    "",
    response_model=list[VacancyCandidateResponse],
    summary="Кандидаты, прикреплённые к вакансии",
)
async def list_matches(
    vacancy_id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[VacancyCandidateResponse]:
    rows = await service.list_for_vacancy(db, vacancy_id)
    return [_to_dto(m) for m in rows]


@vacancy_matches_router.post(
    "",
    response_model=VacancyCandidateResponse,
    summary="Прикрепить кандидата (идемпотентно)",
)
async def attach_candidate(
    vacancy_id: uuid.UUID,
    payload: AttachRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyCandidateResponse:
    match = await service.attach(db, user, vacancy_id, payload.candidate_id)
    return _to_dto(match)


@matches_router.patch("/{match_id}", response_model=VacancyCandidateResponse, summary="Обновить связку")
async def update_match(
    match_id: uuid.UUID,
    payload: UpdateMatchRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyCandidateResponse:
    match = await service.update_match(db, match_id, payload)
    return _to_dto(match)


@matches_router.delete("/{match_id}", response_model=OkResponse, summary="Открепить кандидата")
async def detach_candidate(
    match_id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.detach(db, match_id)
    return OkResponse()


# Альяс для include_router: внешний api_router включит обе.
router = matches_router  # backward-compat: исторически файл экспортирует `router`
