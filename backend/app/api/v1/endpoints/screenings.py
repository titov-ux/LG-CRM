"""Эндпоинты AI-скрининга: /screenings."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.screening import service
from app.modules.screening.models import ScreeningStatus
from app.modules.screening.schemas import (
    AddQuestionRequest,
    AttachAudioRequest,
    CreateScreeningRequest,
    FinishScreeningRequest,
    ScreeningListResponse,
    ScreeningSegmentDTO,
    ScreeningSessionResponse,
    UpdateQuestionRequest,
    UpdateScreeningRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/screenings", tags=["screenings"])


@router.get("", response_model=ScreeningListResponse, summary="Список сессий скрининга")
async def list_screenings(
    candidate_id: uuid.UUID | None = Query(None, alias="candidateId"),
    vacancy_id: uuid.UUID | None = Query(None, alias="vacancyId"),
    recruiter_id: uuid.UUID | None = Query(None, alias="recruiterId"),
    status_filter: ScreeningStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100, alias="pageSize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningListResponse:
    return await service.list_sessions(
        db,
        user,
        candidate_id=candidate_id,
        vacancy_id=vacancy_id,
        recruiter_id=recruiter_id,
        status_filter=status_filter,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=ScreeningSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать сессию скрининга",
)
async def create_screening(
    payload: CreateScreeningRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.create(db, user, payload)


@router.get(
    "/{session_id}",
    response_model=ScreeningSessionResponse,
    summary="Сессия скрининга",
)
async def get_screening(
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.get(db, user, session_id)


@router.patch(
    "/{session_id}",
    response_model=ScreeningSessionResponse,
    summary="Обновить сессию (ссылка на Телемост, согласие)",
)
async def update_screening(
    session_id: uuid.UUID,
    payload: UpdateScreeningRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.update(db, user, session_id, payload)


@router.delete("/{session_id}", response_model=OkResponse, summary="Удалить сессию")
async def delete_screening(
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete(db, user, session_id)
    return OkResponse()


@router.post(
    "/{session_id}/start",
    response_model=ScreeningSessionResponse,
    summary="Начать встречу (draft → live; требует согласия)",
)
async def start_screening(
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.start(db, user, session_id)


@router.post(
    "/{session_id}/finish",
    response_model=ScreeningSessionResponse,
    summary="Завершить встречу (live → done)",
)
async def finish_screening(
    session_id: uuid.UUID,
    payload: FinishScreeningRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.finish(db, user, session_id, payload)


@router.get(
    "/{session_id}/segments",
    response_model=list[ScreeningSegmentDTO],
    summary="Транскрипт сессии (финальные сегменты)",
)
async def list_segments(
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ScreeningSegmentDTO]:
    return await service.list_segments(db, user, session_id)


@router.post(
    "/{session_id}/audio",
    response_model=ScreeningSessionResponse,
    summary="Привязать запись разговора (файл из /files)",
)
async def attach_audio(
    session_id: uuid.UUID,
    payload: AttachAudioRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.attach_audio(db, user, session_id, payload.file_id)


@router.post(
    "/{session_id}/questions",
    response_model=ScreeningSessionResponse,
    summary="Добавить вопрос в чек-лист",
)
async def add_question(
    session_id: uuid.UUID,
    payload: AddQuestionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.add_question(db, user, session_id, payload)


@router.patch(
    "/{session_id}/questions/{question_id}",
    response_model=ScreeningSessionResponse,
    summary="Изменить вопрос (текст / статус / порядок)",
)
async def update_question(
    session_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: UpdateQuestionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.update_question(db, user, session_id, question_id, payload)


@router.delete(
    "/{session_id}/questions/{question_id}",
    response_model=ScreeningSessionResponse,
    summary="Удалить вопрос",
)
async def delete_question(
    session_id: uuid.UUID,
    question_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScreeningSessionResponse:
    return await service.delete_question(db, user, session_id, question_id)
