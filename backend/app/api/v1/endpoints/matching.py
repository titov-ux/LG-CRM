"""Эндпоинты matching: /vacancies/{id}/candidates и /matches/{id}."""
from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.candidates.models import Candidate
from app.modules.matching import ai as matching_ai
from app.modules.matching import service
from app.modules.matching.models import VacancyCandidate
from app.modules.matching.schemas import (
    AttachRequest,
    MatchScoreResponse,
    RankedCandidate,
    ScoreCandidateRequest,
    UpdateMatchRequest,
    VacancyCandidateResponse,
)
from app.modules.permissions.dependencies import require_action_dep
from app.modules.permissions.service import require_action
from app.modules.users.models import User
from app.modules.vacancies import service as vacancies_service
from app.modules.vacancies.models import Vacancy

logger = logging.getLogger(__name__)


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

# Права на связки. Раньше здесь проверялось только право ПРОСМОТРА (роутерный
# _MATCH_DEPS), а вакансия грузилась через db.get — поэтому viewer/бухгалтер
# могли прикреплять/откреплять кандидатов и запускать платный LLM-скоринг, а
# AM — работать с чужими и удалёнными вакансиями. Теперь:
#   * вакансия всегда грузится через vacancies_service.get_vacancy (404 для
#     удалённых, «только свои» для AM);
#   * всё, что меняет связки или тратит LLM, требует `vacancy:edit`.
_EDIT_ACTION = "vacancy:edit"
_EDIT_MESSAGE = "Нет прав на работу с кандидатами вакансии"


async def _require_edit(db: AsyncSession, user: User) -> None:
    await require_action(db, user, _EDIT_ACTION, message=_EDIT_MESSAGE)


async def _visible_vacancy(db: AsyncSession, user: User, vacancy_id: uuid.UUID) -> Vacancy:
    return await vacancies_service.get_vacancy(db, user, vacancy_id)


async def _visible_match(db: AsyncSession, user: User, match_id: str) -> VacancyCandidate:
    real_id = await _resolve_match_id(db, match_id)
    match = await db.get(VacancyCandidate, real_id)
    if match is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Связка не найдена")
    await _visible_vacancy(db, user, match.vacancy_id)
    return match


# Этот роутер крепится по разным префиксам:
#   * /vacancies/{id}/candidates — пристёгнут к роутеру vacancies (см. ниже)
#   * /matches/{match_id} — отдельный роутер
# Связки «вакансия ↔ кандидат» требуют доступа и к вакансиям, и к кандидатам.
_MATCH_DEPS = [
    Depends(require_action_dep("vacancy:view", message="Нет доступа к вакансиям")),
    Depends(require_action_dep("candidate:view", message="Нет доступа к кандидатам")),
]
matches_router = APIRouter(prefix="/matches", tags=["matching"], dependencies=_MATCH_DEPS)
vacancy_matches_router = APIRouter(
    prefix="/vacancies/{vacancy_id}/candidates", tags=["matching"], dependencies=_MATCH_DEPS
)


def _to_dto(m) -> VacancyCandidateResponse:
    return VacancyCandidateResponse.model_validate(m)


@vacancy_matches_router.get(
    "",
    response_model=list[VacancyCandidateResponse],
    summary="Кандидаты, прикреплённые к вакансии",
)
async def list_matches(
    vacancy_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[VacancyCandidateResponse]:
    await _visible_vacancy(db, user, vacancy_id)
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
    await _require_edit(db, user)
    await _visible_vacancy(db, user, vacancy_id)
    match = await service.attach(db, user, vacancy_id, payload.candidate_id)
    return _to_dto(match)


@matches_router.patch("/{match_id}", response_model=VacancyCandidateResponse, summary="Обновить связку")
async def update_match(
    match_id: str,
    payload: UpdateMatchRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyCandidateResponse:
    await _require_edit(db, user)
    existing = await _visible_match(db, user, match_id)
    match = await service.update_match(db, existing.id, payload)
    return _to_dto(match)


@matches_router.delete("/{match_id}", response_model=OkResponse, summary="Открепить кандидата")
async def detach_candidate(
    match_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await _require_edit(db, user)
    existing = await _visible_match(db, user, match_id)
    await service.detach(db, existing.id)
    return OkResponse()


# === AI-скоринг ==============================================================
async def _load_payloads(
    db: AsyncSession, vacancy_id: uuid.UUID, candidate_id: uuid.UUID
) -> tuple[Vacancy, Candidate, dict[str, Any], dict[str, Any]]:
    vac = await db.get(Vacancy, vacancy_id)
    cand = await db.get(Candidate, candidate_id)
    if vac is None or cand is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Вакансия или кандидат не найдены")
    return vac, cand, service.candidate_payload(cand), service.vacancy_payload(vac)


def _score_dto(
    *,
    result: dict[str, Any],
    vacancy_id: uuid.UUID,
    candidate_id: uuid.UUID,
    match_id: uuid.UUID | None,
    current_hash: str,
    ai_enriched: bool,
) -> MatchScoreResponse:
    from datetime import datetime, timezone

    stale = result.get("input_hash") != current_hash
    return MatchScoreResponse.model_validate(
        {
            "matchId": match_id,
            "vacancyId": vacancy_id,
            "candidateId": candidate_id,
            "score": result["score"],
            "recommendation": result["recommendation"],
            "breakdown": result["breakdown"],
            "summary": result.get("summary"),
            "strengths": result.get("strengths") or [],
            "gaps": result.get("gaps") or [],
            "model": result.get("model") or "cheap",
            "scoredAt": result.get("scored_at") or datetime.now(timezone.utc),
            "stale": stale,
            "aiEnriched": ai_enriched,
        }
    )


def _map_ai_error(exc: Exception) -> ApiError:
    """LLM-ошибки, которые НЕ перехвачены graceful-фоллбэком, → HTTP."""
    if isinstance(exc, matching_ai.AiTruncatedJsonError):
        return ApiError(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "input_too_long",
            "Данные кандидата/вакансии слишком объёмны для AI-оценки. Сократите описание.",
        )
    if isinstance(exc, matching_ai.AiBadRequestError):
        return ApiError(
            status.HTTP_502_BAD_GATEWAY,
            "ai_bad_request",
            "Не удалось получить AI-оценку. Попробуйте позже.",
        )
    raise exc


@matches_router.post(
    "/{match_id}/score",
    response_model=MatchScoreResponse,
    summary="Посчитать/пересчитать AI-скоринг связки",
)
async def score_match_endpoint(
    match_id: str,
    force: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MatchScoreResponse:
    await _require_edit(db, user)
    match = await _visible_match(db, user, match_id)

    _, _, cand_payload, vac_payload = await _load_payloads(
        db, match.vacancy_id, match.candidate_id
    )
    try:
        result, _from_cache, ai_enriched = await service.score_and_store(
            db, match, cand_payload, vac_payload, actor=user, force=force
        )
    except (matching_ai.AiBadRequestError, matching_ai.AiTruncatedJsonError) as exc:
        raise _map_ai_error(exc) from exc

    current_hash = matching_ai.compute_input_hash(cand_payload, vac_payload)
    return _score_dto(
        result=result,
        vacancy_id=match.vacancy_id,
        candidate_id=match.candidate_id,
        match_id=match.id,
        current_hash=current_hash,
        ai_enriched=ai_enriched,
    )


@matches_router.get(
    "/{match_id}/score",
    response_model=MatchScoreResponse,
    summary="Сохранённый AI-скоринг связки (без LLM)",
)
async def get_match_score(
    match_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MatchScoreResponse:
    match = await _visible_match(db, user, match_id)
    if match.ai_score is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_scored", "Скоринг ещё не считался")

    _, _, cand_payload, vac_payload = await _load_payloads(
        db, match.vacancy_id, match.candidate_id
    )
    current_hash = matching_ai.compute_input_hash(cand_payload, vac_payload)
    result = service._result_from_match(match)
    return _score_dto(
        result=result,
        vacancy_id=match.vacancy_id,
        candidate_id=match.candidate_id,
        match_id=match.id,
        current_hash=current_hash,
        ai_enriched=(match.ai_model or "cheap") != "cheap",
    )


@vacancy_matches_router.post(
    "/score",
    response_model=list[MatchScoreResponse],
    summary="Батч-скоринг всех прикреплённых кандидатов вакансии",
)
async def score_vacancy_candidates(
    vacancy_id: uuid.UUID,
    force: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MatchScoreResponse]:
    await _require_edit(db, user)
    await _visible_vacancy(db, user, vacancy_id)
    matches = await service.list_for_vacancy(db, vacancy_id)
    out: list[MatchScoreResponse] = []
    for match in matches:
        try:
            _, _, cand_payload, vac_payload = await _load_payloads(
                db, match.vacancy_id, match.candidate_id
            )
            result, _from_cache, ai_enriched = await service.score_and_store(
                db, match, cand_payload, vac_payload, actor=user, force=force
            )
            current_hash = matching_ai.compute_input_hash(cand_payload, vac_payload)
            out.append(
                _score_dto(
                    result=result,
                    vacancy_id=match.vacancy_id,
                    candidate_id=match.candidate_id,
                    match_id=match.id,
                    current_hash=current_hash,
                    ai_enriched=ai_enriched,
                )
            )
        except (matching_ai.AiBadRequestError, matching_ai.AiTruncatedJsonError) as exc:
            # Частичный успех: один кандидат упал — остальных всё равно считаем.
            logger.warning("batch score skipped match %s: %s", match.id, exc)
            continue
    return out


@vacancy_matches_router.post(
    "/score-preview",
    response_model=MatchScoreResponse,
    summary="Превью AI-скоринга кандидата под вакансию (без прикрепления)",
)
async def score_candidate_preview(
    vacancy_id: uuid.UUID,
    payload: ScoreCandidateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MatchScoreResponse:
    # Превью ходит в LLM (платно) — как и сохранение скоринга, нужно vacancy:edit.
    await _require_edit(db, user)
    await _visible_vacancy(db, user, vacancy_id)
    _, _, cand_payload, vac_payload = await _load_payloads(
        db, vacancy_id, payload.candidate_id
    )
    try:
        result = await matching_ai.score_match(cand_payload, vac_payload)
        ai_enriched = True
    except matching_ai.AiUnavailableError:
        result = matching_ai.cheap_result(cand_payload, vac_payload)
        ai_enriched = False
    except (matching_ai.AiBadRequestError, matching_ai.AiTruncatedJsonError) as exc:
        raise _map_ai_error(exc) from exc

    current_hash = matching_ai.compute_input_hash(cand_payload, vac_payload)
    return _score_dto(
        result=result,
        vacancy_id=vacancy_id,
        candidate_id=payload.candidate_id,
        match_id=None,
        current_hash=current_hash,
        ai_enriched=ai_enriched,
    )


@vacancy_matches_router.get(
    "/rank",
    response_model=list[RankedCandidate],
    summary="Подобрать кандидатов из базы под вакансию (ранжирование)",
)
async def rank_candidates_endpoint(
    vacancy_id: uuid.UUID,
    limit: int = Query(default=20, ge=1, le=100),
    enrich: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RankedCandidate]:
    if enrich:
        # enrich=true дообогащает топ через LLM — платная операция.
        await _require_edit(db, user)
    vac = await _visible_vacancy(db, user, vacancy_id)
    rows = await service.rank_candidates(db, vac, limit=limit, enrich=enrich)
    return [RankedCandidate.model_validate(r) for r in rows]


# Альяс для include_router: внешний api_router включит обе.
router = matches_router  # backward-compat: исторически файл экспортирует `router`
