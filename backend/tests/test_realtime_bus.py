"""Unit-тесты на шину realtime-событий.

С миграции на Redis pub/sub `EventBus` имеет два режима:
  * `redis=None` — чисто локальный fanout (этим режимом пользуются тесты);
  * `redis=<async client>` — события публикуются ещё и в Redis pub/sub для
    других воркеров (это покрыто отдельно через fakeredis).

Эти тесты не требуют Postgres / Redis — проверяют только сам EventBus и
хелперы publish_* (включая echo-метку через current_client_id_var).
"""
from __future__ import annotations

import asyncio
import uuid

import pytest

from app.realtime.bus import EventBus
from app.realtime.events import (
    current_client_id_var,
    publish_candidate_changed,
    publish_vacancy_changed,
)


@pytest.mark.asyncio
async def test_bus_delivers_to_subscriber() -> None:
    bus = EventBus()
    q = await bus.subscribe()
    bus.publish({"hello": "world"})
    event = await asyncio.wait_for(q.get(), timeout=0.5)
    assert event == {"hello": "world"}
    await bus.unsubscribe(q)


@pytest.mark.asyncio
async def test_bus_fanout_to_many() -> None:
    bus = EventBus()
    q1 = await bus.subscribe()
    q2 = await bus.subscribe()
    bus.publish({"n": 1})
    e1 = await asyncio.wait_for(q1.get(), timeout=0.5)
    e2 = await asyncio.wait_for(q2.get(), timeout=0.5)
    assert e1 == e2 == {"n": 1}


@pytest.mark.asyncio
async def test_bus_overflow_drops_oldest() -> None:
    bus = EventBus()
    q = await bus.subscribe()
    # Заполняем очередь до отказа + 1.
    for i in range(q.maxsize + 1):
        bus.publish({"i": i})
    # После переполнения самый старый должен быть выброшен.
    drained: list[int] = []
    while not q.empty():
        ev = q.get_nowait()
        drained.append(ev["i"])
    assert drained[0] != 0
    assert drained[-1] == q.maxsize  # последний — самый свежий


@pytest.mark.asyncio
async def test_publish_vacancy_carries_client_id() -> None:
    """current_client_id_var должен попадать в payload события."""
    from app.realtime.bus import get_bus

    bus = get_bus()
    q = await bus.subscribe()
    try:
        token = current_client_id_var.set("client-abc")
        try:
            publish_vacancy_changed("updated", id=uuid.uuid4())
        finally:
            current_client_id_var.reset(token)
        event = await asyncio.wait_for(q.get(), timeout=0.5)
        assert event["type"] == "vacancy.changed"
        assert event["kind"] == "updated"
        assert event["clientId"] == "client-abc"
    finally:
        await bus.unsubscribe(q)


@pytest.mark.asyncio
async def test_publish_candidate_reordered_carries_ids() -> None:
    from app.realtime.bus import get_bus

    bus = get_bus()
    q = await bus.subscribe()
    try:
        ids = [uuid.uuid4(), uuid.uuid4()]
        publish_candidate_changed("reordered", ids=ids, actor_id=uuid.uuid4())
        event = await asyncio.wait_for(q.get(), timeout=0.5)
        assert event["type"] == "candidate.changed"
        assert event["kind"] == "reordered"
        assert set(event["ids"]) == {str(i) for i in ids}
        assert event["id"] is None
    finally:
        await bus.unsubscribe(q)


@pytest.mark.asyncio
async def test_publish_never_raises_even_without_subscribers() -> None:
    """publish_* должен «глотать» любые ошибки — иначе мутация в API упадёт 500."""
    # Без подписчиков просто ничего не происходит — без падения.
    publish_vacancy_changed("created", id=uuid.uuid4(), actor_id=uuid.uuid4())
    publish_candidate_changed("deleted", id=uuid.uuid4(), actor_id=uuid.uuid4())


@pytest.mark.asyncio
async def test_redis_pubsub_delivers_across_instances() -> None:
    """Главный тест миграции: события, опубликованные в одном инстансе bus,
    доходят до подписчика во втором инстансе через Redis pub/sub.

    Это имитирует прод-сценарий с `--workers > 1`: воркер #1 публикует
    событие → воркер #2 получает его через Redis-канал и доставляет в свои
    WebSocket-очереди.
    """
    import fakeredis.aioredis as fakeredis_async

    # Один общий fakeredis-сервер, к которому подключаются оба инстанса.
    server = fakeredis_async.FakeServer()
    redis_a = fakeredis_async.FakeRedis(server=server, decode_responses=True)
    redis_b = fakeredis_async.FakeRedis(server=server, decode_responses=True)

    bus_a = EventBus(redis=redis_a, channel="test:realtime")
    bus_b = EventBus(redis=redis_b, channel="test:realtime")
    await bus_a.start_listener()
    await bus_b.start_listener()
    try:
        # Подписчик на воркере B.
        q_b = await bus_b.subscribe()
        # Воркер A публикует.
        bus_a.publish({"type": "vacancy.changed", "id": "v1"})
        # B должен получить событие через Redis.
        event = await asyncio.wait_for(q_b.get(), timeout=2.0)
        assert event["type"] == "vacancy.changed"
        assert event["id"] == "v1"
        # `_bus_source` — служебная метка, должна быть удалена перед доставкой.
        assert "_bus_source" not in event
    finally:
        await bus_a.stop_listener()
        await bus_b.stop_listener()
        await redis_a.aclose()
        await redis_b.aclose()


@pytest.mark.asyncio
async def test_redis_pubsub_no_self_duplicate() -> None:
    """Bus не должен доставлять собственное событие дважды: один раз
    локально (синхронно в publish), второй раз — из Redis pub/sub.
    """
    import fakeredis.aioredis as fakeredis_async

    server = fakeredis_async.FakeServer()
    redis = fakeredis_async.FakeRedis(server=server, decode_responses=True)

    bus = EventBus(redis=redis, channel="test:realtime")
    await bus.start_listener()
    try:
        q = await bus.subscribe()
        bus.publish({"type": "candidate.changed", "id": "c1"})
        # Первое событие — локальная мгновенная доставка.
        e1 = await asyncio.wait_for(q.get(), timeout=2.0)
        assert e1["id"] == "c1"
        # Никаких дублей из Redis быть не должно — даём времени листенеру.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(q.get(), timeout=0.5)
    finally:
        await bus.stop_listener()
        await redis.aclose()
