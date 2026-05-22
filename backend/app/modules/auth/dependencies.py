"""FastAPI-зависимости модуля auth.

Главная — `get_current_user`: проверяет Bearer-токен, достаёт User из БД.
Будет переиспользоваться всеми защищёнными эндпоинтами проекта.
"""
from __future__ import annotations

import uuid

from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.redis import get_redis
from app.core.security import decode_token
from app.db.session import get_db
from app.modules.users.models import User

# auto_error=False — мы хотим сами формировать ApiError, не дефолтный 403.
_bearer = HTTPBearer(auto_error=False)


async def _redis_dep() -> Redis:
    return get_redis()


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "unauthenticated", "Не авторизован")
    try:
        payload = decode_token(creds.credentials)
    except InvalidTokenError as e:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "invalid_token", "Невалидный или истёкший токен"
        ) from e
    if payload.get("type") != "access":
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Ожидается access-токен")
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as e:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Битый sub") from e

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "user_inactive", "Пользователь недоступен")
    # Прокладываем в request.state — пригодится audit-логике.
    request.state.user_id = str(user.id)
    return user


def require_roles(*roles: str):
    """Декоратор-зависимость: ограничить эндпоинт ролями."""
    allowed = {r for r in roles}

    async def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role.value not in allowed:
            raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет прав на действие")
        return user

    return _checker
