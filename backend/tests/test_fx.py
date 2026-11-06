"""Курс USD→RUB (app/modules/fx): кэш, фоллбэк, пересчёт сумм."""
from __future__ import annotations

import asyncio

import fakeredis.aioredis as fakeredis_async
import pytest

from app.modules.fx import service as fx


@pytest.fixture
def fake_redis(monkeypatch):
    r = fakeredis_async.FakeRedis(decode_responses=True)
    monkeypatch.setattr(fx, "get_redis", lambda: r)
    return r


def test_to_rub() -> None:
    assert fx.to_rub(100, "RUB", None) == 100
    assert fx.to_rub(100, None, None) == 100
    assert fx.to_rub(10, "USD", 90.5) == 905
    assert fx.to_rub(10, "USD", None) is None


def test_fetch_then_cache(fake_redis, monkeypatch) -> None:
    calls = []

    async def fake_fetch():
        calls.append(1)
        return fx.FxRate(usd_rub=81.25, date="2026-11-06", source="cbr")

    monkeypatch.setattr(fx, "_fetch_cbr", fake_fetch)
    first = asyncio.run(fx.get_usd_rub())
    second = asyncio.run(fx.get_usd_rub())
    assert first.usd_rub == second.usd_rub == 81.25
    assert len(calls) == 1  # второй раз — из кэша


def test_cbr_down_uses_last_known_then_fallback(fake_redis, monkeypatch) -> None:
    async def down():
        return None

    monkeypatch.setattr(fx, "_fetch_cbr", down)
    # Кэша нет, fallback = 0 → курса нет.
    assert asyncio.run(fx.get_usd_rub()).usd_rub is None

    asyncio.run(fake_redis.set(fx._KEY_LAST, '{"usd_rub": 79.0, "date": "2026-11-01", "source": "cbr"}'))
    rate = asyncio.run(fx.get_usd_rub())
    assert rate.usd_rub == 79.0 and rate.source == "cbr_cached"
