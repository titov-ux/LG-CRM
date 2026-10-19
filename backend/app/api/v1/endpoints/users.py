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

from app.core.errors import ApiError
from app.core.redis import get_redis
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.permissions.dependencies import require_action_or_admin
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

# «Управление пользователями» — по праву user:manage из матрицы (админ проходит
# всегда). Раньше было жёстко зашито на admin, и галочка в матрице не работала.
_MANAGE_USERS = require_action_or_admin(
    "user:manage", message="Нет прав на управление пользователями"
)


def _ensure_no_admin_escalation(
    actor: User, *, target: User | None = None, new_role: Role | None = None
) -> None:
    """Не-админ с user:manage не может ни выдать роль admin, ни трогать админов.

    Иначе право «управлять пользователями» = возможность стать админом
    (создать себе админскую учётку или сбросить пароль администратору).
    """
    if actor.role == Role.admin:
        return
    if new_role == Role.admin or (target is not None and target.role == Role.admin):
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Управлять администраторами может только администратор",
        )


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
    actor: User = Depends(_MANAGE_USERS),
    db: AsyncSession = Depends(get_db),
) -> CreateUserResponse:
    """Создать пользователя.

    Если `password` не передан — пользователь создаётся с `isActive=false` и ему
    уходит письмо-приглашение со ссылкой на установку пароля. В этом случае при
    отсутствии SMTP (dev/staging без настроенной почты) в ответе будет поле
    `inviteUrl` — админ может скопировать его вручную.
    """
    _ensure_no_admin_escalation(actor, new_role=payload.role)
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
    actor: User = Depends(_MANAGE_USERS),
    db: AsyncSession = Depends(get_db),
) -> InviteResendResponse:
    _ensure_no_admin_escalation(actor, target=await service.get_user(db, user_id))
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
    actor: User = Depends(_MANAGE_USERS),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    _ensure_no_admin_escalation(
        actor, target=await service.get_user(db, user_id), new_role=payload.role
    )
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
    actor: User = Depends(_MANAGE_USERS),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> OkResponse:
    """Задать пользователю новый пароль без знания текущего.

    Все его активные сессии разлогиниваются. Свой пароль так менять нельзя —
    для этого POST /auth/me/password (с подтверждением текущего пароля).
    """
    _ensure_no_admin_escalation(actor, target=await service.get_user(db, user_id))
    await service.set_password(db, redis, user_id, payload.password, actor_id=actor.id)
    return OkResponse()


@router.delete("/{user_id}", response_model=OkResponse, summary="Удалить пользователя")
async def delete_user(
    user_id: uuid.UUID,
    actor: User = Depends(_MANAGE_USERS),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    _ensure_no_admin_escalation(actor, target=await service.get_user(db, user_id))
    await service.delete_user(db, user_id, actor_id=actor.id)
    return OkResponse()
