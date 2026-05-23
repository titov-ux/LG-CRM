"""Один общий async Redis-клиент на процесс.

Используется для:
* whitelist хэшей активных refresh-токенов (TTL = refresh TTL),
* rate-limit на /auth/login,
* счётчиков неудачных попыток входа (lockout аккаунта).
"""
from __future__ import annotations

from functools import lru_cache

from redis.asyncio import Redis

from app.core.config import get_settings


@lru_cache(maxsize=1)
def get_redis() -> Redis:
    settings = get_settings()
    # decode_responses=True — работаем со строками, а не bytes.
    return Redis.from_url(str(settings.redis_url), decode_responses=True)
