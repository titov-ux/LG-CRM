"""Бизнес-логика auth: login / refresh / logout.

Логика собрана здесь, чтобы эндпоинты остались тонкой обёрткой (FastAPI-роутер).
Это также облегчает тестирование без TestClient.
"""
from __future__ import annotations

from datetime import datetime, timezone

UTC = timezone.utc

from fastapi import status
from jwt import InvalidTokenError
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.modules.auth import store
from app.modules.users.models import User


async def authenticate(
    db: AsyncSession,
    redis: Redis,
    email: str,
    password: str,
    ip: str,
) -> tuple[User, str, str]:
    """Проверить логин и выдать пару (access, refresh).

    Возвращает `(user, access_token, refresh_token)` либо бросает ApiError.
    """
    # 1) Rate limit по IP — 5 попыток в минуту.
    count, _ = await store.hit_rate_limit(redis, ip)
    if count > store.LOGIN_RATE_LIMIT_MAX:
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate_limited",
            "Слишком много попыток входа. Попробуйте через минуту.",
        )

    # 2) Lockout по email — 5 неудач за 15 минут.
    if await store.is_account_locked(redis, email):
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "account_locked",
            "Аккаунт временно заблокирован после нескольких неверных попыток. "
            "Повторите через 15 минут.",
        )

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        if user is not None:
            user.last_failed_login_at = datetime.now(UTC)
            await db.commit()
        await store.record_login_failure(redis, email)
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_credentials", "Неверный email или пароль")

    if not user.is_active:
        raise ApiError(status.HTTP_403_FORBIDDEN, "user_inactive", "Учётная запись неактивна")

    # 3) Успех. Сбрасываем счётчики неудач и выдаём пару токенов.
    await store.reset_login_failures(redis, email)
    access = create_access_token(str(user.id), extra={"role": user.role.value})
    refresh = create_refresh_token(str(user.id))
    await store.remember_refresh(redis, str(user.id), refresh)
    return user, access, refresh


async def rotate_refresh(
    db: AsyncSession,
    redis: Redis,
    refresh_token: str,
) -> tuple[User, str, str]:
    """Проверить refresh-токен, отозвать его и выдать новую пару (ротация)."""
    try:
        payload = decode_token(refresh_token)
    except InvalidTokenError as e:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "invalid_refresh", "Невалидный или истёкший refresh-токен"
        ) from e
    if payload.get("type") != "refresh":
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_refresh", "Ожидается refresh-токен")
    user_id = payload.get("sub", "")

    if not await store.is_refresh_active(redis, user_id, refresh_token):
        # Токен отозван (logout) или подделан — отзываем всё.
        await store.forget_all_refresh(redis, user_id)
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "refresh_revoked", "Сессия завершена")

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        await store.forget_all_refresh(redis, user_id)
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "user_inactive", "Пользователь недоступен")

    # Ротация: старый — в стоп, новый — в whitelist.
    await store.forget_refresh(redis, user_id, refresh_token)
    new_access = create_access_token(str(user.id), extra={"role": user.role.value})
    new_refresh = create_refresh_token(str(user.id))
    await store.remember_refresh(redis, str(user.id), new_refresh)
    return user, new_access, new_refresh


async def revoke(redis: Redis, refresh_token: str | None) -> None:
    """Отозвать конкретный refresh (logout). Тихо игнорирует битые токены."""
    if not refresh_token:
        return
    try:
        payload = decode_token(refresh_token)
    except InvalidTokenError:
        return
    user_id = payload.get("sub")
    if user_id:
        await store.forget_refresh(redis, user_id, refresh_token)
