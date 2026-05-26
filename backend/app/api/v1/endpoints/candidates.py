"""Эндпоинты /candidates (включая archive/restore и kanban)."""
from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.candidates import service
from app.modules.candidates.ai import (
    AiBadRequestError,
    AiUnavailableError,
    parse_resume_text,
)
from app.modules.candidates.resume_ai import improve_resume_for_vacancy
from app.modules.candidates.models import Candidate, CandidateStatus, EmploymentType
from app.modules.candidates.schemas import (
    ArchiveRequest,
    CandidateKanbanOrderRequest,
    CandidatePage,
    CandidateResponse,
    ChangeCandidateStatusRequest,
    CreateCandidateRequest,
    ImproveResumeRequest,
    ImproveResumeResponse,
    ImprovedResume,
    ParsedCandidate,
    ParseResumeTextRequest,
    ParseResumeTextResponse,
    UpdateCandidateRequest,
)
from app.modules.vacancies import service as vacancies_service
from app.modules.users.models import Role, User
from app.modules.vacancies.models import EngagementType, Grade

router = APIRouter(prefix="/candidates", tags=["candidates"])
logger = logging.getLogger(__name__)


def _maybe_mask(value: Any, user: User) -> Any:
    """Маскируем чувствительные поля для роли viewer."""
    return None if user.role == Role.viewer else value


def _to_dto(cand: Candidate, vacancy_ids: list[uuid.UUID], user: User) -> CandidateResponse:
    resume = cand.resume or {}
    return CandidateResponse(
        id=cand.id,
        full_name=cand.full_name,
        role=cand.role,
        engagement_type=cand.engagement_type,
        grade=cand.grade,
        experience_years=float(cand.experience_years),
        stack=list(cand.stack or []),
        rate_month=_maybe_mask(float(cand.rate_month) if cand.rate_month is not None else None, user),
        employment_type=cand.employment_type,
        format=cand.format_,
        location=cand.location,
        recruiter_id=cand.recruiter_id,
        status=cand.status,
        days_in_status=service._days_in_status(cand),
        vacancy_ids=vacancy_ids,
        telegram=cand.telegram,
        phone=_maybe_mask(cand.phone, user),
        email=_maybe_mask(cand.email, user),
        birthday=cand.birthday,
        kanban_order=cand.kanban_order,
        summary=cand.summary,
        skill_categories=resume.get("skillCategories"),
        experience=resume.get("experience"),
        education=resume.get("education"),
        certifications=resume.get("certifications"),
        languages=resume.get("languages"),
        archived=cand.archived,
        archived_at=cand.archived_at,
        archived_by_id=cand.archived_by_id,
        archive_reason=cand.archive_reason,
    )


# --- /kanban-order должен идти раньше /{id} ---


@router.put(
    "/kanban-order",
    response_model=list[CandidateResponse],
    summary="Пакетное обновление порядка карточек кандидатов",
)
async def reorder_kanban(
    payload: CandidateKanbanOrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CandidateResponse]:
    rows, vmap = await service.reorder_kanban(db, user, payload.updates)
    return [_to_dto(c, vmap.get(c.id, []), user) for c in rows]


@router.post(
    "/parse-resume-text",
    response_model=ParseResumeTextResponse,
    summary="AI-распознавание сплошного текста резюме",
)
async def parse_resume(
    payload: ParseResumeTextRequest,
    _: User = Depends(get_current_user),
) -> ParseResumeTextResponse:
    """Разбирает текст резюме (выгруженный из PDF) в поля карточки кандидата.

    Использует YandexGPT (см. `modules/candidates/ai.py`). Если ключ не
    сконфигурирован или сервис недоступен — возвращает 503 ai_unavailable.
    """
    try:
        parsed_raw = await parse_resume_text(
            payload.text,
            today=date.today().isoformat(),
        )
    except AiUnavailableError as exc:
        logger.warning("candidates.parse_resume unavailable: %s", exc)
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ai_unavailable",
            "Сервис AI-распознавания временно недоступен. Заполните карточку вручную.",
        ) from exc
    except AiBadRequestError as exc:
        logger.error("candidates.parse_resume bad request: %s", exc)
        raise ApiError(
            status.HTTP_502_BAD_GATEWAY,
            "ai_bad_request",
            "Не удалось распознать резюме. Попробуйте другой PDF или заполните вручную.",
        ) from exc

    # На случай, если `_coerce_parsed` пропустил кривое поле — ловим ValidationError
    # и тихо отбрасываем именно его, чтобы не падать 500 на пользователе.
    from pydantic import ValidationError

    try:
        parsed = ParsedCandidate.model_validate(parsed_raw)
    except ValidationError as exc:
        bad_keys = {str(e["loc"][0]) for e in exc.errors() if e.get("loc")}
        logger.warning(
            "candidates.parse_resume validation error, dropping fields %s: raw=%r",
            bad_keys,
            parsed_raw,
        )
        cleaned = {k: v for k, v in parsed_raw.items() if k not in bad_keys}
        parsed = ParsedCandidate.model_validate(cleaned)
    return ParseResumeTextResponse(parsed=parsed)


@router.get("", response_model=CandidatePage, summary="Список кандидатов с фильтрами")
async def list_candidates(
    search: str | None = None,
    status_: CandidateStatus | None = Query(default=None, alias="status"),
    grade: Grade | None = None,
    recruiter_id: uuid.UUID | None = Query(default=None, alias="recruiterId"),
    stack: str | None = None,
    engagement_type: EngagementType | None = Query(default=None, alias="engagementType"),
    employment_type: EmploymentType | None = Query(default=None, alias="employmentType"),
    archived: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CandidatePage:
    # archived принимается как "true"/"false"/"all"
    archived_param: bool | str | None
    if archived is None or archived == "":
        archived_param = False
    elif archived == "all":
        archived_param = "all"
    else:
        archived_param = archived.lower() == "true"
    rows, total, vmap = await service.list_candidates(
        db,
        user,
        search=search,
        status_=status_,
        grade=grade.value if grade else None,
        recruiter_id=recruiter_id,
        stack=stack,
        engagement_type=engagement_type,
        employment_type=employment_type.value if employment_type else None,
        archived=archived_param,
        page=page,
        page_size=page_size,
    )
    return CandidatePage(
        items=[_to_dto(c, vmap.get(c.id, []), user) for c in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=CandidateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать кандидата",
)
async def create_candidate(
    payload: CreateCandidateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CandidateResponse:
    try:
        cand, vids = await service.create_candidate(db, user, payload)
        return _to_dto(cand, vids, user)
    except ApiError:
        raise
    except Exception as exc:
        logger.exception(
            "Unexpected error while creating candidate",
            extra={"recruiter_id": str(payload.recruiter_id), "actor_id": str(user.id)},
        )
        raise ApiError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "candidate_create_failed",
            "Не удалось создать кандидата из-за внутренней ошибки сервера",
            details={"errorType": exc.__class__.__name__},
        ) from exc


@router.get("/{cand_id}", response_model=CandidateResponse, summary="Кандидат по id")
async def get_candidate(
    cand_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CandidateResponse:
    cand, vids = await service.get_candidate(db, cand_id)
    return _to_dto(cand, vids, user)


@router.patch("/{cand_id}", response_model=CandidateResponse, summary="Обновить кандидата")
async def update_candidate(
    cand_id: uuid.UUID,
    payload: UpdateCandidateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CandidateResponse:
    cand, vids = await service.update_candidate(db, user, cand_id, payload)
    return _to_dto(cand, vids, user)


@router.patch(
    "/{cand_id}/status",
    response_model=CandidateResponse,
    summary="Сменить статус кандидата",
)
async def change_status(
    cand_id: uuid.UUID,
    payload: ChangeCandidateStatusRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CandidateResponse:
    cand, vids = await service.change_status(db, user, cand_id, payload)
    return _to_dto(cand, vids, user)


@router.post(
    "/{cand_id}/archive",
    response_model=CandidateResponse,
    summary="Убрать кандидата с канбан-доски",
)
async def archive_candidate(
    cand_id: uuid.UUID,
    payload: ArchiveRequest = ArchiveRequest(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CandidateResponse:
    cand, vids = await service.archive_candidate(db, user, cand_id, payload.reason)
    return _to_dto(cand, vids, user)


@router.post(
    "/{cand_id}/restore",
    response_model=CandidateResponse,
    summary="Вернуть кандидата на доску",
)
async def restore_candidate(
    cand_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CandidateResponse:
    cand, vids = await service.restore_candidate(db, user, cand_id)
    return _to_dto(cand, vids, user)


@router.post(
    "/{cand_id}/resume/improve",
    response_model=ImproveResumeResponse,
    summary="AI-адаптация резюме кандидата под конкретную вакансию",
)
async def improve_resume(
    cand_id: uuid.UUID,
    payload: ImproveResumeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImproveResumeResponse:
    """Просит YandexGPT адаптировать summary/стек/категории/буллеты опыта под вакансию.

    Менять можно только переформулировку (никаких новых компаний/технологий).
    Фронт мерджит результат в кандидата и тут же отдаёт пользователю DOCX.

    Ошибки:
      * 503 `ai_unavailable` — нет ключа AI / сеть / 5xx;
      * 502 `ai_bad_request` — 4xx от Yandex AI Studio.
    """
    cand, _ = await service.get_candidate(db, cand_id)
    # get_vacancy сделает 404 если вакансия не существует или невидима пользователю.
    vac = await vacancies_service.get_vacancy(db, user, payload.vacancy_id)

    cand_dto = _to_dto(cand, [], user).model_dump(by_alias=True, exclude_none=True)
    vac_payload = {
        "title": vac.title,
        "grade": vac.grade.value if vac.grade else None,
        "stack": list(vac.stack or []),
        "description": vac.description,
        "requirements": vac.requirements,
    }

    try:
        raw = await improve_resume_for_vacancy(
            candidate_payload=cand_dto,
            vacancy_payload=vac_payload,
        )
    except AiUnavailableError as exc:
        logger.warning("candidates.improve_resume unavailable: %s", exc)
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ai_unavailable",
            "Сервис AI-адаптации резюме временно недоступен. Скачайте резюме в оригинале.",
        ) from exc
    except AiBadRequestError as exc:
        logger.error("candidates.improve_resume bad request: %s", exc)
        raise ApiError(
            status.HTTP_502_BAD_GATEWAY,
            "ai_bad_request",
            "Не удалось адаптировать резюме. Скачайте в оригинале или попробуйте позже.",
        ) from exc

    # `raw` уже почищен (длина experience совпадает, em-dash убраны).
    # Тем не менее на всякий случай прогоняем через Pydantic — это даст
    # понятную 422 при неожиданной форме вместо невнятного 500 у пользователя.
    improvement = ImprovedResume.model_validate(raw)
    return ImproveResumeResponse(improvement=improvement)


@router.delete("/{cand_id}", response_model=OkResponse, summary="Удалить кандидата")
async def delete_candidate(
    cand_id: uuid.UUID,
    permanent: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_candidate(db, user, cand_id, permanent=permanent)
    return OkResponse()
