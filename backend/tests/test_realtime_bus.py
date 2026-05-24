"""Unit-тесты на in-memory шину realtime-событий.

Не требуют Postgres / Redis — проверяют только сам EventBus и хелперы
publish_* (включая echo-метку через current_client_id_var).
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
