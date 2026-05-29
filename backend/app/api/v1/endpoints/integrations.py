"""Эндпоинты /integrations/hh.

Скоуп первого этапа:
  * GET  /integrations/hh/status — статус подключения (для UI настроек)
  * POST /integrations/hh/oauth/start — выдать authorize_url + state
  * POST /integrations/hh/oauth/exchange — обмен code → токены (фронт принимает
    callback hh, забирает code и отдаёт сюда)
  * POST /integrations/hh/disconnect — отвязать аккаунт (admin)
  * POST /integrations/hh/import-resume — импортировать резюме по URL/ID
    в карточку кандидата; при vacancyId — сразу на канбан вакансии.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import (
    get_current_user,
    get_current_user_or_api_token,
)
from app.modules.auth.schemas import OkResponse
from app.modules.candidates.schemas import CandidateResponse
from app.modules.integrations import service
from app.modules.integrations.schemas import (
    HhAuthorizeUrlResponse,
    HhExchangeCodeRequest,
    HhImportResumeRequest,
    HhStatusResponse,
)
from app.modules.users.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/hh", tags=["integrations"])


@router.get(
    "/status",
    response_model=HhStatusResponse,
    summary="Статус подключения hh.ru",
)
async def get_status(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HhStatusResponse:
    data = await service.status_dto(db)
    return HhStatusResponse(
        configured=data["configured"],
        connected=data["connected"],
        account_label=data["accountLabel"],
        expires_at=data["expiresAt"],
    )


@router.post(
    "/oauth/start",
    response_model=HhAuthorizeUrlResponse,
    summary="Начать OAuth-флоу: получить authorize_url + state",
)
async def oauth_start(
    user: User = Depends(get_current_user),
    _: AsyncSession = Depends(get_db),
) -> HhAuthorizeUrlResponse:
    state = await service.issue_oauth_state(user)
    authorize_url = service.build_authorize_url_for_state(state)
    return HhAuthorizeUrlResponse(authorize_url=authorize_url, state=state)


@router.post(
    "/oauth/exchange",
    response_model=HhStatusResponse,
    summary="Обменять code на токены и сохранить",
)
async def oauth_exchange(
    payload: HhExchangeCodeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HhStatusResponse:
    # CSRF: state должен быть тем, что мы сами выдавали ≤10 минут назад.
    await service.consume_oauth_state(payload.state)
    await service.exchange_code_and_save(db, code=payload.code, user=user)
    data = await service.status_dto(db)
    return HhStatusResponse(
        configured=data["configured"],
        connected=data["connected"],
        account_label=data["accountLabel"],
        expires_at=data["expiresAt"],
    )


@router.post(
    "/disconnect",
    response_model=OkResponse,
    summary="Отвязать hh-аккаунт от CRM",
)
async def disconnect(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.disconnect(db, user=user)
    return OkResponse()


@router.post(
    "/import-resume",
    response_model=CandidateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Импортировать резюме hh по URL/ID и создать кандидата",
)
async def import_resume(
    payload: HhImportResumeRequest,
    # Принимаем И JWT (из CRM-фронта), И personal API-токен (из Chrome-
    # расширения hh.ru) — поэтому get_current_user_or_api_token, не get_current_user.
    user: User = Depends(get_current_user_or_api_token),
    db: AsyncSession = Depends(get_db),
) -> CandidateResponse:
    # Используем тот же сериализатор, что и /candidates — чтобы фронт получил
    # привычный CandidateResponse и сразу подставил карточку в канбан.
    from app.api.v1.endpoints.candidates import _to_dto

    cand, vids = await service.import_resume(
        db,
        user=user,
        raw_url_or_id=payload.url,
        vacancy_id=payload.vacancy_id,
        recruiter_id=payload.recruiter_id,
    )
    return _to_dto(cand, vids, user)
