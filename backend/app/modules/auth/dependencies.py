"""FastAPI-зависимости модуля auth.

Главная — `get_current_user`: проверяет Bearer-токен, достаёт User из БД.
Будет переиспользоваться всеми защищёнными эндпоинтами проекта.

`get_current_user_or_api_token` принимает ДВА типа токена в одном заголовке
`Authorization: Bearer ...`:
  * JWT access-токен (для CRM-фронта)
  * personal API-токен `lg_*` (для Chrome-расширения hh.ru)
Используется только эндпоинтами, к которым ходят оба клиента — например,
POST /integrations/hh/import-resume.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.redis import get_redis
from app.core.security import decode_token
from app.db.session import get_db
from app.modules.users.api_tokens import (
    UserApiToken,
    hash_token,
    is_extension_token,
)
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


async def _resolve_api_token(db: AsyncSession, raw: str) -> User:
    """Принять lg_-токен, обновить last_used_at и вернуть владельца.

    Токен ищется по sha256-хэшу (raw в БД не хранится). Отозванный
    (revoked_at IS NOT NULL) или принадлежащий неактивному пользователю
    токен валит 401.
    """
    token_hash = hash_token(raw)
    row = (
        await db.execute(
            select(UserApiToken, User)
            .join(User, User.id == UserApiToken.user_id)
            .where(UserApiToken.token_hash == token_hash)
        )
    ).one_or_none()
    if row is None:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Неизвестный API-токен")
    token, user = row
    if token.revoked_at is not None:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "token_revoked", "API-токен отозван")
    if not user.is_active:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "user_inactive", "Пользователь недоступен")
    token.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return user


async def get_current_user_or_api_token(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Принимает JWT access-токен (фронт CRM) или personal API-токен `lg_*`
    (Chrome-расширение). Различает по префиксу — JWT начинается с `ey`, наш
    extension-токен с `lg_`.
    """
    if creds is None or creds.scheme.lower() != "bearer":
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "unauthenticated", "Не авторизован")
    raw = creds.credentials
    if is_extension_token(raw):
        user = await _resolve_api_token(db, raw)
        request.state.user_id = str(user.id)
        return user
    # Fallback на стандартный JWT-flow.
    try:
        payload = decode_token(raw)
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
    request.state.user_id = str(user.id)
    return user
