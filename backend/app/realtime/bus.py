"""In-memory асинхронная событийная шина.

Шина одна на процесс. Подписчик получает свой `asyncio.Queue`, в которую
`publish()` положит копию каждого события. Очередь ограничена по размеру —
если подписчик «залип», лишние события дропаются (а не блокируют publisher).

Если в будущем будет несколько инстансов backend-а (масштабирование), это
место заменим на Redis pub/sub — интерфейс остаётся тем же.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

logger = logging.getLogger(__name__)


# Если у подписчика накопилось столько сообщений — самое старое выбрасываем,
# чтобы быстро восстанавливаться, а не выжирать память.
_QUEUE_MAXSIZE = 256


class EventBus:
    """Простой fan-out: один publisher → много subscribers."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        """Зарегистрировать новую очередь подписчика."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        async with self._lock:
            self._subscribers.add(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers.discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        """Безопасно для вызова из синхронного кода и из любых сервисов.

        Не падает, если подписчик медленный — просто дропает старое сообщение
        и кладёт новое. Также не падает, если шину дёргают вне event-loop-а
        (например, из синхронного тестового кода).
        """
        # Снэпшот подписчиков на момент рассылки — без лока, чтобы не блокировать
        # publisher на await. На set операции add/discard — атомарные, гонка
        # максимум в том, что только что отписавшийся подписчик получит ещё одно
        # сообщение и оно потом GC-нется вместе с очередью.
        subscribers = tuple(self._subscribers)
        for q in subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Дропаем самое старое и кладём новое.
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    logger.warning("realtime: subscriber queue overflow, dropping event")

    async def stream(self, q: asyncio.Queue[dict[str, Any]]) -> AsyncIterator[dict[str, Any]]:
        while True:
            event = await q.get()
            yield event


_bus: EventBus | None = None


def get_bus() -> EventBus:
    """Lazy-singleton: один EventBus на процесс."""
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
