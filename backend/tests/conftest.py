"""Общие фикстуры pytest для auth-флоу.

Требуется реальный Postgres (см. infra/docker-compose.dev.yml или сервис в CI),
т.к. модели используют CITEXT и `uuid_generate_v4()`. Redis заменяется на
`fakeredis.aioredis.FakeRedis` — никакого инфра-зависимости в тестах.

Каждый тест получает свою БД-сессию в транзакции, которая откатывается в конце —
тесты не оставляют мусор в users.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator

import fakeredis.aioredis as fakeredis_async
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.api.v1.endpoints import auth as auth_ep
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.modules.users.models import Role, User


# pytest-asyncio: один event loop на сессию (нужно для async-фикстур-сессий)
@pytest.fixture(scope="session")
def event_loop() -> Iterator[asyncio.AbstractEventLoop]:
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def engine() -> AsyncIterator:
    settings = get_settings()
    eng = create_async_engine(str(settings.database_url), pool_pre_ping=True)
    # Создаём схему один раз на сессию (для CI). В прод-окружении не запускается.
    async with eng.begin() as conn:
        await conn.execute(
            __import__("sqlalchemy").text(
                'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; '
                "CREATE EXTENSION IF NOT EXISTS citext;"
            )
        )
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await eng.dispose()


@pytest_asyncio.fixture()
async def db(engine) -> AsyncIterator[AsyncSession]:
    """Сессия в обёртке транзакции, откатывается после теста."""
    conn: AsyncConnection = await engine.connect()
    trans = await conn.begin()
    factory = async_sessionmaker(bind=conn, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        try:
            yield session
        finally:
            await session.close()
    await trans.rollback()
    await conn.close()


@pytest_asyncio.fixture()
async def fake_redis() -> AsyncIterator:
    redis = fakeredis_async.FakeRedis(decode_responses=True)
    yield redis
    await redis.flushall()
    await redis.aclose()


@pytest.fixture()
def client(db: AsyncSession, fake_redis) -> Iterator[TestClient]:
    """TestClient с override get_db / get_redis на изолированные ресурсы."""

    async def _override_db() -> AsyncIterator[AsyncSession]:
        yield db

    def _override_redis():
        return fake_redis

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[auth_ep._redis_dep] = _override_redis
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture()
async def admin_user(db: AsyncSession) -> User:
    return await _make_user(db, "admin@lg.ru", "correct-horse-battery-staple", Role.admin, True)


@pytest_asyncio.fixture()
async def recruiter_user(db: AsyncSession) -> User:
    return await _make_user(db, "rec@lg.ru", "correct-horse-battery-staple", Role.recruiter, True)


@pytest_asyncio.fixture()
async def account_manager_user(db: AsyncSession) -> User:
    return await _make_user(db, "am@lg.ru", "correct-horse-battery-staple", Role.account_manager, True)


@pytest_asyncio.fixture()
async def other_account_manager_user(db: AsyncSession) -> User:
    return await _make_user(
        db, "am2@lg.ru", "correct-horse-battery-staple", Role.account_manager, True
    )


@pytest_asyncio.fixture()
async def inactive_user(db: AsyncSession) -> User:
    return await _make_user(db, "ghost@lg.ru", "correct-horse-battery-staple", Role.recruiter, False)


def auth_headers(client, email: str, password: str = "correct-horse-battery-staple") -> dict[str, str]:
    """Логинит пользователя и возвращает Authorization-заголовок с Bearer-токеном.

    Использует тот же TestClient, чтобы fakeredis-инстанс и БД-сессия совпадали
    с теми, что увидит дальнейший запрос.
    """
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


async def _make_user(
    db: AsyncSession, email: str, password: str, role: Role, is_active: bool
) -> User:
    from app.core.security import hash_password
    from app.modules.users.models import compute_initials

    user = User(
        email=email,
        password_hash=hash_password(password),
        full_name=email.split("@")[0],
        role=role,
        is_active=is_active,
        initials=compute_initials(email.split("@")[0]),
        color="#0ea5e9",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
