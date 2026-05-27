"""Unit-тесты на presence-store.

Проверяем оба режима:
* `_InMemoryPresenceStore` — поведение, эквивалентное старому in-process dict-у
  (используется в тестах, fallback в проде если Redis недоступен).
* `_RedisPresenceStore` поверх fakeredis — главное, ради чего затевалась
  миграция: общий снапшот для нескольких «воркеров» (двух разных инстансов
  store-а, подключенных к одному Redis).

Lua-скрипты fakeredis выполняет нативно (поддержка `eval`).
"""
from __future__ import annotations

import asyncio

import fakeredis.aioredis as fakeredis_async
import pytest

from app.realtime.presence import (
    _InMemoryPresenceStore,
    _RedisPresenceStore,
)


# === in-memory ==============================================================


@pytest.mark.asyncio
async def test_inmemory_connect_then_disconnect_single_connection() -> None:
    store = _InMemoryPresenceStore()
    snapshot, became_online = await store.connect("u1", "c1")
    assert became_online is True
    assert snapshot == ["u1"]

    became_offline = await store.disconnect("u1", "c1")
    assert became_offline is True
    assert await store.snapshot() == []


@pytest.mark.asyncio
async def test_inmemory_two_tabs_same_user_only_one_online_transition() -> None:
    """При двух WS-соединениях одного юзера became_online/offline должны
    подняться только на первом коннекте и последнем дисконнекте.
    """
    store = _InMemoryPresenceStore()
    _, online_1 = await store.connect("u1", "c1")
    _, online_2 = await store.connect("u1", "c2")
    assert online_1 is True
    assert online_2 is False  # вторая вкладка не «новый» онлайн

    off_1 = await store.disconnect("u1", "c1")
    off_2 = await store.disconnect("u1", "c2")
    assert off_1 is False
    assert off_2 is True


@pytest.mark.asyncio
async def test_inmemory_repeated_disconnect_is_noop() -> None:
    """Повторный disconnect неизвестного connection_id не падает и не
    возвращает became_offline."""
    store = _InMemoryPresenceStore()
    await store.connect("u1", "c1")
    assert await store.disconnect("u1", "c1") is True
    # Повторно — уже нет такого соединения.
    assert await store.disconnect("u1", "c1") is False


# === Redis ==================================================================


async def _make_redis_store(
    server: fakeredis_async.FakeServer | None = None,
    **kwargs,
) -> tuple[_RedisPresenceStore, fakeredis_async.FakeRedis]:
    server = server or fakeredis_async.FakeServer()
    redis = fakeredis_async.FakeRedis(server=server, decode_responses=True)
    store = _RedisPresenceStore(redis, **kwargs)
    return store, redis


@pytest.mark.asyncio
async def test_redis_connect_disconnect_basic() -> None:
    store, redis = await _make_redis_store()
    try:
        snapshot, online = await store.connect("u1", "c1")
        assert online is True
        assert snapshot == ["u1"]
        assert await redis.sismember("crm:presence:online", "u1") == 1

        offline = await store.disconnect("u1", "c1")
        assert offline is True
        assert await redis.sismember("crm:presence:online", "u1") == 0
        assert await redis.exists("crm:presence:conns:u1") == 0
    finally:
        await redis.aclose()


@pytest.mark.asyncio
async def test_redis_multi_workers_share_snapshot() -> None:
    """Главный сценарий миграции: два инстанса store-а на одном Redis
    видят один общий снапшот онлайн юзеров.
    """
    server = fakeredis_async.FakeServer()
    store_a, redis_a = await _make_redis_store(server=server)
    store_b, redis_b = await _make_redis_store(server=server)
    try:
        # Юзер 1 коннектится через воркер A.
        snap_a, online_a = await store_a.connect("u1", "c1")
        assert online_a is True
        assert snap_a == ["u1"]

        # Юзер 2 коннектится через воркер B. Воркер B видит обоих.
        snap_b, online_b = await store_b.connect("u2", "c2")
        assert online_b is True
        assert sorted(snap_b) == ["u1", "u2"]

        # И воркер A теперь тоже видит u2 (общий снапшот через Redis).
        assert sorted(await store_a.snapshot()) == ["u1", "u2"]
    finally:
        await redis_a.aclose()
        await redis_b.aclose()


@pytest.mark.asyncio
async def test_redis_multi_tabs_dont_double_count_online_transition() -> None:
    """Две вкладки одного юзера (возможно на разных воркерах) — became_online
    только на первой, became_offline только на последней. Это инвариант
    Lua-скрипта connect/disconnect.
    """
    server = fakeredis_async.FakeServer()
    store_a, redis_a = await _make_redis_store(server=server)
    store_b, redis_b = await _make_redis_store(server=server)
    try:
        _, online_a = await store_a.connect("u1", "c1")
        _, online_b = await store_b.connect("u1", "c2")
        assert online_a is True
        assert online_b is False

        off_a = await store_a.disconnect("u1", "c1")
        off_b = await store_b.disconnect("u1", "c2")
        assert off_a is False
        assert off_b is True
    finally:
        await redis_a.aclose()
        await redis_b.aclose()


@pytest.mark.asyncio
async def test_redis_heartbeat_extends_ttl() -> None:
    """heartbeat должен продлевать запись и не давать ZREMRANGEBYSCORE её
    выбросить. Используем короткий TTL, чтобы тест бежал быстро.
    """
    store, redis = await _make_redis_store(
        connection_ttl_seconds=2, key_grace_seconds=1
    )
    try:
        await store.connect("u1", "c1")
        # Сразу после connect запись «живёт» ~2с. Подождём 1с и продлим.
        await asyncio.sleep(1.0)
        await store.heartbeat("u1", "c1")
        # Sweep сразу после heartbeat — никого не должен снять.
        offlined = await store.sweep()
        assert offlined == []
        assert await redis.sismember("crm:presence:online", "u1") == 1
    finally:
        await redis.aclose()


@pytest.mark.asyncio
async def test_redis_sweep_removes_expired() -> None:
    """Если воркер умер и heartbeat не пришёл — sweep подметает запись и
    возвращает user_id, ставшего offline. Это поведение, ради которого
    Redis-presence вообще нужен (in-process dict никогда не освободится).
    """
    store, redis = await _make_redis_store(
        connection_ttl_seconds=1, key_grace_seconds=1
    )
    try:
        await store.connect("u1", "c1")
        await store.connect("u2", "c2")
        # u2 ещё «живой» — продлим. u1 оставим протухать.
        # Чуть больше TTL — гарантируем истечение.
        await asyncio.sleep(1.2)
        await store.heartbeat("u2", "c2")

        offlined = await store.sweep()
        assert offlined == ["u1"]
        assert await redis.sismember("crm:presence:online", "u1") == 0
        assert await redis.sismember("crm:presence:online", "u2") == 1
    finally:
        await redis.aclose()


@pytest.mark.asyncio
async def test_redis_sweep_keeps_user_with_some_live_connections() -> None:
    """У юзера два соединения, протухает только одно — юзер остаётся online."""
    store, redis = await _make_redis_store(
        connection_ttl_seconds=1, key_grace_seconds=2
    )
    try:
        await store.connect("u1", "c-old")
        await store.connect("u1", "c-fresh")
        # Протухнет c-old, c-fresh продлим.
        await asyncio.sleep(1.2)
        await store.heartbeat("u1", "c-fresh")

        offlined = await store.sweep()
        assert offlined == []
        assert await redis.sismember("crm:presence:online", "u1") == 1
        # В sorted-set осталась только живая запись.
        members = await redis.zrange("crm:presence:conns:u1", 0, -1)
        assert members == ["c-fresh"]
    finally:
        await redis.aclose()


@pytest.mark.asyncio
async def test_redis_repeated_connect_same_connection_is_idempotent() -> None:
    """Защита от двойного hello: повторный connect с тем же connection_id
    не должен делать ничего нового — became_online остаётся False во второй
    раз, и в master-set нет дублей (SADD идемпотентен).
    """
    store, redis = await _make_redis_store()
    try:
        _, online_1 = await store.connect("u1", "c1")
        _, online_2 = await store.connect("u1", "c1")
        assert online_1 is True
        assert online_2 is False
        # Только одна запись в sorted-set, даже после двух connect.
        members = await redis.zrange("crm:presence:conns:u1", 0, -1)
        assert members == ["c1"]
    finally:
        await redis.aclose()
