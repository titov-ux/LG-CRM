"""Эндпоинты /me/api-tokens — управление personal API-токенами.

Используются Chrome-расширением hh.ru для аутентификации запросов к
/integrations/hh/import-resume. Каждый пользователь сам выпускает себе
токен — на странице настроек CRM.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.db.session import get_db
from app.modules.auth.dependencies import (
    get_current_user,
    get_current_user_or_api_token,
)
from app.modules.auth.schemas import OkResponse
from app.modules.users.api_tokens import (
    UserApiToken,
    generate_raw_token,
    hash_token,
)
from app.modules.users.models import User

router = APIRouter(prefix="/me/api-tokens", tags=["api-tokens"])

# Чтобы не плодить токены в БД случайными нажатиями. 5 активных за глаза
# хватит — основной кейс: один токен на одно устройство/расширение.
_MAX_ACTIVE_TOKENS_PER_USER = 5


class ApiTokenItem(CamelModel):
    id: uuid.UUID
    name: str
    prefix: str  # «lg_abc123» для UI
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime


class CreateApiTokenRequest(CamelModel):
    name: str = Field(min_length=1, max_length=128)


class CreateApiTokenResponse(CamelModel):
    item: ApiTokenItem
    # Plain-токен показываем ОДИН раз при выпуске; восстановить нельзя.
    raw_token: str


class VerifyTokenResponse(CamelModel):
    ok: bool = True
    user_id: uuid.UUID
    email: str


@router.get(
    "/verify",
    response_model=VerifyTokenResponse,
    summary="Проверить токен (принимает JWT и lg_-токен расширения)",
)
async def verify_token(
    # В отличие от остальных /me/api-tokens этот эндпоинт принимает И personal
    # `lg_`-токен — его дёргает кнопка «Проверить» в Chrome-расширении, где
    # JWT нет. Раньше расширение било в GET "" (JWT-only) и всегда ловило 401.
    user: User = Depends(get_current_user_or_api_token),
) -> VerifyTokenResponse:
    return VerifyTokenResponse(user_id=user.id, email=user.email)


@router.get("", response_model=list[ApiTokenItem], summary="Список моих API-токенов")
async def list_my_tokens(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ApiTokenItem]:
    rows = (
        await db.execute(
            select(UserApiToken)
            .where(UserApiToken.user_id == user.id)
            .order_by(UserApiToken.created_at.desc())
        )
    ).scalars().all()
    return [ApiTokenItem.model_validate(r, from_attributes=True) for r in rows]


@router.post(
    "",
    response_model=CreateApiTokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Выпустить новый API-токен",
)
async def create_my_token(
    payload: CreateApiTokenRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CreateApiTokenResponse:
    # Считаем активные (не отозванные) — лимит на пользователя.
    active_count = (
        await db.execute(
            select(UserApiToken).where(
                UserApiToken.user_id == user.id,
                UserApiToken.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    if len(active_count) >= _MAX_ACTIVE_TOKENS_PER_USER:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "too_many_tokens",
            f"Достигнут лимит активных токенов ({_MAX_ACTIVE_TOKENS_PER_USER}). "
            "Отзовите неиспользуемые.",
        )

    raw = generate_raw_token()
    token = UserApiToken(
        user_id=user.id,
        name=payload.name.strip(),
        token_hash=hash_token(raw),
        # Префикс показываем в UI — «какой именно токен у меня в расширении».
        # `lg_` + 5 — достаточно для различимости и не утечка энтропии.
        prefix=raw[:8],
    )
    db.add(token)
    await db.commit()
    await db.refresh(token)
    return CreateApiTokenResponse(
        item=ApiTokenItem.model_validate(token, from_attributes=True),
        raw_token=raw,
    )


@router.delete("/{token_id}", response_model=OkResponse, summary="Отозвать API-токен")
async def revoke_my_token(
    token_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    token = (
        await db.execute(
            select(UserApiToken).where(
                UserApiToken.id == token_id,
                UserApiToken.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if token is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Токен не найден")
    if token.revoked_at is None:
        token.revoked_at = datetime.now(timezone.utc)
        await db.commit()
    return OkResponse()
