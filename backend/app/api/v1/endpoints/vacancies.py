"""Эндпоинты /vacancies (+ kanban-операции + transitions)."""
from __future__ import annotations

import logging
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.users.models import User
from app.modules.vacancies import service, transitions
from app.modules.vacancies.ai import (
    AiBadRequestError,
    AiUnavailableError,
    parse_vacancy_text,
)
from app.modules.vacancies.models import (
    EngagementType,
    Grade,
    Priority,
    Vacancy as VacancyModel,
    VacancyStatus,
)
from app.modules.vacancies.schemas import (
    ChangeStatusRequest,
    CreateVacancyRequest,
    KanbanOrderRequest,
    ParsedVacancy,
    ParseVacancyTextRequest,
    ParseVacancyTextResponse,
    TransitionsResponse,
    UpdateVacancyRequest,
    VacancyPage,
    VacancyResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vacancies", tags=["vacancies"])


def _to_dto(vac: VacancyModel) -> VacancyResponse:
    return VacancyResponse(
        id=vac.id,
        title=vac.title,
        client_id=vac.client_id,
        engagement_type=vac.engagement_type,
        project=vac.project,
        grade=vac.grade,
        stack=list(vac.stack or []),
        format=vac.format_,
        rate_client=float(vac.rate_client or 0),
        salary_max=float(vac.salary_max) if vac.salary_max is not None else None,
        positions=vac.positions,
        status=vac.status,
        priority=vac.priority,
        account_manager_id=vac.account_manager_id,
        recruiter_ids=service._recruiter_ids(vac),
        days_in_status=service._days_in_status(vac),
        candidates_count=0,  # Этап 5 — появится с matching
        deadline=vac.deadline,
        kanban_order=vac.kanban_order,
        description=vac.description,
        requirements=vac.requirements,
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
    response_model=list[VacancyResponse],
    summary="Пакетное обновление порядка карточек",
)
async def reorder_kanban(
    payload: KanbanOrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[VacancyResponse]:
    rows = await service.reorder_kanban(db, user, payload.updates)
    return [_to_dto(v) for v in rows]


@router.post(
    "/parse-text",
    response_model=ParseVacancyTextResponse,
    summary="AI-распознавание сплошного текста брифа",
)
async def parse_text(
    payload: ParseVacancyTextRequest,
    _: User = Depends(get_current_user),
) -> ParseVacancyTextResponse:
    """Разбирает текст брифа от клиента в поля формы.

    Использует Anthropic Claude (см. `modules/vacancies/ai.py`). Если ключ не
    сконфигурирован или сервис недоступен — возвращает 503 ai_unavailable.
    """
    try:
        parsed_raw = await parse_vacancy_text(
            payload.text,
            today=date.today().isoformat(),
        )
    except AiUnavailableError as exc:
        logger.warning("vacancies.parse_text unavailable: %s", exc)
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ai_unavailable",
            "Сервис AI-распознавания временно недоступен. Заполните поля вручную.",
        ) from exc
    except AiBadRequestError as exc:
        logger.error("vacancies.parse_text bad request: %s", exc)
        raise ApiError(
            status.HTTP_502_BAD_GATEWAY,
            "ai_bad_request",
            "Не удалось распознать текст. Проверьте формат и попробуйте снова.",
        ) from exc

    # `parsed_raw` уже в camelCase — но Pydantic с alias_generator примет и snake/camel.
    return ParseVacancyTextResponse(parsed=ParsedVacancy.model_validate(parsed_raw))


@router.get("", response_model=VacancyPage, summary="Список вакансий с фильтрами")
async def list_vacancies(
    search: str | None = None,
    status_: VacancyStatus | None = Query(default=None, alias="status"),
    client_id: uuid.UUID | None = Query(default=None, alias="clientId"),
    grade: Grade | None = None,
    priority: Priority | None = None,
    recruiter_id: uuid.UUID | None = Query(default=None, alias="recruiterId"),
    account_manager_id: uuid.UUID | None = Query(default=None, alias="accountManagerId"),
    engagement_type: EngagementType | None = Query(default=None, alias="engagementType"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyPage:
    rows, total = await service.list_vacancies(
        db,
        user,
        search=search,
        status_=status_,
        client_id=client_id,
        grade=grade,
        priority=priority,
        recruiter_id=recruiter_id,
        account_manager_id=account_manager_id,
        engagement_type=engagement_type,
        page=page,
        page_size=page_size,
    )
    return VacancyPage(
        items=[_to_dto(v) for v in rows], total=total, page=page, page_size=page_size
    )


@router.post(
    "",
    response_model=VacancyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать вакансию",
)
async def create_vacancy(
    payload: CreateVacancyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyResponse:
    vac = await service.create_vacancy(db, user, payload)
    return _to_dto(vac)


@router.get("/{vac_id}", response_model=VacancyResponse, summary="Вакансия по id")
async def get_vacancy(
    vac_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyResponse:
    vac = await service.get_vacancy(db, user, vac_id)
    return _to_dto(vac)


@router.patch("/{vac_id}", response_model=VacancyResponse, summary="Обновить вакансию")
async def update_vacancy(
    vac_id: uuid.UUID,
    payload: UpdateVacancyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyResponse:
    vac = await service.update_vacancy(db, user, vac_id, payload)
    return _to_dto(vac)


@router.delete("/{vac_id}", response_model=OkResponse, summary="Удалить вакансию (soft)")
async def delete_vacancy(
    vac_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_vacancy(db, user, vac_id)
    return OkResponse()


@router.patch(
    "/{vac_id}/status",
    response_model=VacancyResponse,
    summary="Сменить статус вакансии",
)
async def change_status(
    vac_id: uuid.UUID,
    payload: ChangeStatusRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VacancyResponse:
    vac = await service.change_status(db, user, vac_id, payload)
    return _to_dto(vac)
