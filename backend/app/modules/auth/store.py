"""Redis-store для auth-подсистемы.

Содержит:
* `refresh_*` — whitelist активных refresh-токенов (ротация на каждом /refresh);
* `rate_*` — счётчик попыток логина с одного IP (5/мин → 429);
* `lockout_*` — счётчик неудачных попыток на email; после 5 неудач — блокировка
  аккаунта на 15 минут (ТЗ §5.1).

Хранение: хэш refresh-токена (sha256), а не сам токен — даже при дампе Redis
нельзя восстановить токены.
"""
from __future__ import annotations

import hashlib

from redis.asyncio import Redis

from app.core.config import get_settings

# Параметры rate/lockout — соответствуют ТЗ §5.1 и плану §4 (Этап 1).
LOGIN_RATE_LIMIT_WINDOW_S = 60
LOGIN_RATE_LIMIT_MAX = 5
LOGIN_LOCKOUT_THRESHOLD = 5
LOGIN_LOCKOUT_DURATION_S = 15 * 60


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _refresh_key(user_id: str, token_hash: str) -> str:
    return f"auth:refresh:{user_id}:{token_hash}"


def _rate_key(ip: str) -> str:
    return f"auth:login:rate:{ip}"


def _fail_key(email: str) -> str:
    return f"auth:login:fail:{email.lower()}"


# ─────────────── refresh whitelist ───────────────


async def remember_refresh(redis: Redis, user_id: str, token: str) -> None:
    settings = get_settings()
    ttl = settings.refresh_token_ttl_days * 24 * 60 * 60
    await redis.set(_refresh_key(user_id, _hash_token(token)), "1", ex=ttl)


async def is_refresh_active(redis: Redis, user_id: str, token: str) -> bool:
    return (await redis.exists(_refresh_key(user_id, _hash_token(token)))) == 1


async def forget_refresh(redis: Redis, user_id: str, token: str) -> None:
    await redis.delete(_refresh_key(user_id, _hash_token(token)))


async def forget_all_refresh(redis: Redis, user_id: str) -> None:
    """Удалить все refresh-токены пользователя (logout-everywhere / смена пароля)."""
    pattern = f"auth:refresh:{user_id}:*"
    async for key in redis.scan_iter(match=pattern):
        await redis.delete(key)


# ─────────────── rate limit ───────────────


async def hit_rate_limit(redis: Redis, ip: str) -> tuple[int, int]:
    """Инкремент счётчика, возвращает (count, ttl_seconds).

    При превышении `LOGIN_RATE_LIMIT_MAX` вызывающий код вернёт 429.
    """
    key = _rate_key(ip)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, LOGIN_RATE_LIMIT_WINDOW_S)
    ttl = await redis.ttl(key)
    return count, max(ttl, 0)


# ─────────────── lockout по email ───────────────


async def record_login_failure(redis: Redis, email: str) -> int:
    key = _fail_key(email)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, LOGIN_LOCKOUT_DURATION_S)
    if count >= LOGIN_LOCKOUT_THRESHOLD:
        # При превышении ставим явный lock-флаг с тем же TTL.
        await redis.set(f"{key}:locked", "1", ex=LOGIN_LOCKOUT_DURATION_S)
    return count


async def is_account_locked(redis: Redis, email: str) -> bool:
    return (await redis.exists(f"{_fail_key(email)}:locked")) == 1


async def reset_login_failures(redis: Redis, email: str) -> None:
    key = _fail_key(email)
    await redis.delete(key, f"{key}:locked")
