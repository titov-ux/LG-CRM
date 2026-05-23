"""Async SQLAlchemy engine + session factory.

Engine создаётся лениво — `import app.main` не дёргает драйвер БД. Это важно
для тестов с переопределёнными зависимостями и для пайплайнов, где сервис БД
поднимается параллельно с приложением.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings


@lru_cache(maxsize=1)
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        str(settings.database_url),
        echo=settings.debug,
        pool_pre_ping=True,
    )


@lru_cache(maxsize=1)
def _get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False, class_=AsyncSession)


def SessionLocal() -> AsyncSession:  # noqa: N802 — оставляем привычное имя
    """Создать новую сессию (используется в скриптах вне FastAPI)."""
    return _get_sessionmaker()()


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: открывает сессию на запрос, закрывает в finally."""
    async with _get_sessionmaker()() as session:
        yield session
