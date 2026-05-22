"""CRUD-эндпоинты /users.

GET доступен всем авторизованным (фронту нужен справочник для аватарок,
автокомплита @-упоминаний и т.п.). Мутирующие операции — только админ
(право `users.manage` в матрице).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user, require_roles
from app.modules.auth.schemas import OkResponse
from app.modules.users import service
from app.modules.users.models import Role, User
from app.modules.users.schemas import (
    CreateUserRequest,
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
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать пользователя",
)
async def create_user(
    payload: CreateUserRequest,
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    user = await service.create_user(db, payload)
    return UserResponse.model_validate(user)


@router.patch("/{user_id}", response_model=UserResponse, summary="Обновить пользователя")
async def update_user(
    user_id: uuid.UUID,
    payload: UpdateUserRequest,
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    user = await service.update_user(db, user_id, payload)
    return UserResponse.model_validate(user)


@router.delete("/{user_id}", response_model=OkResponse, summary="Удалить пользователя")
async def delete_user(
    user_id: uuid.UUID,
    actor: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_user(db, user_id, actor_id=actor.id)
    return OkResponse()
