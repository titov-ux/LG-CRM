"""Эндпоинты matching: /vacancies/{id}/candidates и /matches/{id}."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.matching import service
from app.modules.matching.models import VacancyCandidate
from app.modules.matching.schemas import (
    AttachRequest,
    UpdateMatchRequest,
    VacancyCandidateResponse,
)
from app.modules.users.models import User


async def _resolve_match_id(db: AsyncSession, match_id: str) -> uuid.UUID:
    """Принять matchId в двух форматах и вернуть реальный UUID связки.

    Поддерживаем оба варианта, чтобы фронт мог не таскать match.id из ответа
    GET /vacancies/{id}/candidates (он работает по паре vacancy+candidate):
      * `m-{vacancyId}-{candidateId}` — синтетический ключ, по которому ищем
        связку в БД и возвращаем её настоящий UUID;
      * обычный UUID — отдаём как есть.

    Любые мусорные форматы — 404 (а не 422), чтобы UI получал понятный «не найдено».
    """
    if match_id.startswith("m-"):
        rest = match_id[2:]
        try:
            # UUID-строки содержат '-', поэтому простой split не подходит.
            # Безопасный путь: первые 36 символов — vacancy_id, потом '-', потом candidate_id.
            if len(rest) < 36 + 1 + 36 or rest[36] != "-":
                raise ValueError
            vacancy_id = uuid.UUID(rest[:36])
            candidate_id = uuid.UUID(rest[37:])
        except (ValueError, IndexError) as exc:
            raise ApiError(
                status.HTTP_404_NOT_FOUND, "not_found", "Связка не найдена"
            ) from exc
        row = (
            await db.execute(
                select(VacancyCandidate).where(
                    VacancyCandidate.vacancy_id == vacancy_id,
                    VacancyCandidate.candidate_id == candidate_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Связка не найдена")
        return row.id
    try:
        return uuid.UUID(match_id)
    except ValueError as exc:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "Связка не найдена"
        ) from exc

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
    match_id: str,
    payload: UpdateMatchRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyCandidateResponse:
    real_id = await _resolve_match_id(db, match_id)
    match = await service.update_match(db, real_id, payload)
    return _to_dto(match)


@matches_router.delete("/{match_id}", response_model=OkResponse, summary="Открепить кандидата")
async def detach_candidate(
    match_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    real_id = await _resolve_match_id(db, match_id)
    await service.detach(db, real_id)
    return OkResponse()


# Альяс для include_router: внешний api_router включит обе.
router = matches_router  # backward-compat: исторически файл экспортирует `router`
