"""CRUD-эндпоинты /users.

GET доступен всем авторизованным (фронту нужен справочник для аватарок,
автокомплита @-упоминаний и т.п.). Мутирующие операции — только админ
(право `users.manage` в матрице).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user, require_roles
from app.modules.auth.schemas import OkResponse
from app.modules.users import service
from app.modules.users.models import Role, User
from app.modules.users.schemas import (
    CreateUserRequest,
    CreateUserResponse,
    InviteResendResponse,
    SetPasswordRequest,
    UpdateUserRequest,
    UserResponse,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse], summary="Список пользователей")
async def list_users(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UserResponse]:
    users = await service.list_users(db)
    return [UserResponse.model_validate(u) for u in users]


@router.post(
    "",
    response_model=CreateUserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать пользователя",
)
async def create_user(
    payload: CreateUserRequest,
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> CreateUserResponse:
    """Создать пользователя.

    Если `password` не передан — пользователь создаётся с `isActive=false` и ему
    уходит письмо-приглашение со ссылкой на установку пароля. В этом случае при
    отсутствии SMTP (dev/staging без настроенной почты) в ответе будет поле
    `inviteUrl` — админ может скопировать его вручную.
    """
    user, fallback_token = await service.create_user(db, payload)
    invite_url = service._build_invite_url(fallback_token) if fallback_token else None
    return CreateUserResponse(
        user=UserResponse.model_validate(user),
        invite_url=invite_url,
    )


@router.post(
    "/{user_id}/invite",
    response_model=InviteResendResponse,
    summary="Переотправить приглашение",
)
async def resend_invite(
    user_id: uuid.UUID,
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> InviteResendResponse:
    user, fallback_token = await service.reissue_invite(db, user_id)
    invite_url = service._build_invite_url(fallback_token) if fallback_token else None
    return InviteResendResponse(
        user=UserResponse.model_validate(user),
        invite_url=invite_url,
        email_sent=fallback_token is None,
    )


@router.patch("/{user_id}", response_model=UserResponse, summary="Обновить пользователя")
async def update_user(
    user_id: uuid.UUID,
    payload: UpdateUserRequest,
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    user = await service.update_user(db, user_id, payload)
    return UserResponse.model_validate(user)


@router.post(
    "/{user_id}/password",
    response_model=OkResponse,
    summary="Сбросить пароль пользователя (админ)",
)
async def set_user_password(
    user_id: uuid.UUID,
    payload: SetPasswordRequest,
    actor: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> OkResponse:
    """Задать пользователю новый пароль без знания текущего.

    Все его активные сессии разлогиниваются. Свой пароль так менять нельзя —
    для этого POST /auth/me/password (с подтверждением текущего пароля).
    """
    await service.set_password(db, redis, user_id, payload.password, actor_id=actor.id)
    return OkResponse()


@router.delete("/{user_id}", response_model=OkResponse, summary="Удалить пользователя")
async def delete_user(
    user_id: uuid.UUID,
    actor: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_user(db, user_id, actor_id=actor.id)
    return OkResponse()
