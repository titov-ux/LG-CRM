"""Realtime-шина: локальный fan-out + межпроцессная доставка через Redis pub/sub.

Зачем понадобился Redis. До этого `EventBus` был чистым in-memory pub/sub-ом,
поэтому при запуске backend-а с `--workers > 1` события, опубликованные в
воркере A, не доходили до WebSocket-ов, обслуживаемых воркером B. На проде
это приводило к тому, что новые сообщения чата не приходили в realtime —
только после refresh страницы (`infra/docker-compose.prod.yml` запускает
uvicorn с `--workers 2`).

Архитектура сейчас:

* `publish(event)` — синхронный (как и раньше), потому что вызывается из
  сервисов после `db.commit()` без `await`.
    1. Сразу fanout-ит событие в локальные очереди этого же процесса —
       мгновенная доставка для клиентов, прицепленных к этому воркеру.
    2. Дополнительно публикует событие в Redis на канал `crm:realtime` через
       `asyncio.create_task` — другие воркеры увидят его через listener.
* `_listen()` — фоновая корутина (по одной на процесс), читает Redis pub/sub
  и доставляет в локальные очереди ТОЛЬКО события «не от себя» (по
  `_bus_source` — уникальному id инстанса). Так избегаем дублей.
* `subscribe()`/`unsubscribe()` — интерфейс не изменился: клиент получает
  свой `asyncio.Queue`, в который попадают и локальные, и внешние события.

Fallback: если Redis-клиент не передан (тесты с in-memory шиной), bus работает
по-старому — только локальный fanout.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


# Pub/sub-канал — один на весь backend. Все realtime-события (vacancy, candidate,
# chat, presence) идут через него; разделение по подписчикам — на стороне
# `_pump_events` в endpoints/realtime.py (audience-фильтр).
_CHANNEL = "crm:realtime"

# Если у подписчика накопилось столько сообщений — самое старое выбрасываем,
# чтобы быстро восстанавливаться, а не выжирать память.
_QUEUE_MAXSIZE = 256


class EventBus:
    """Pub/sub-шина с локальным fan-out и опциональной репликацией через Redis.

    Если в конструктор передан async Redis-клиент — события дополнительно
    публикуются в Redis-канал, а фоновый listener этого же инстанса
    подписывается на канал и доставляет события от других процессов. Если
    Redis нет (None) — bus ведёт себя как чисто in-memory pub/sub (это
    используется в unit-тестах).
    """

    def __init__(self, redis: Redis | None = None, channel: str = _CHANNEL) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = asyncio.Lock()
        self._redis = redis
        self._channel = channel
        self._listener_task: asyncio.Task[None] | None = None
        self._stopped = False
        # Уникальный идентификатор этого инстанса (= процесса) — нужен, чтобы
        # отфильтровать собственные сообщения, прилетевшие к нам же через
        # Redis pub/sub (мы их уже доставили локально в `publish`).
        self._source_id = str(uuid.uuid4())

    # === subscribers ========================================================

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        """Зарегистрировать новую очередь подписчика."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        async with self._lock:
            self._subscribers.add(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers.discard(q)

    # === publishing =========================================================

    def publish(self, event: dict[str, Any]) -> None:
        """Опубликовать событие.

        Безопасно для вызова из любого места — не бросает исключений и не
        блокирует publisher даже если подписчик «залип» или Redis тормозит.
        Локальные подписчики получат событие синхронно сразу же; другие
        воркеры — через Redis в фоне.
        """
        # 1. Локальная мгновенная доставка для текущего процесса.
        self._deliver_local(event)
        # 2. Межпроцессная доставка через Redis (если доступен).
        if self._redis is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # Нет event-loop-а (вызов из синхронного контекста, например
            # тестов или скриптов). Локальная доставка уже выполнена, выходим.
            return
        # `_bus_source` — служебная метка, listener Redis её снимет и не
        # доставит событие повторно нам же.
        payload = dict(event)
        payload["_bus_source"] = self._source_id
        loop.create_task(self._redis_publish(payload))

    def _deliver_local(self, event: dict[str, Any]) -> None:
        """Fan-out в локальные очереди (без Redis)."""
        # Снэпшот подписчиков на момент рассылки — без лока, чтобы не
        # блокировать publisher на await.
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
                    logger.warning(
                        "realtime: subscriber queue overflow, dropping event"
                    )

    async def _redis_publish(self, payload: dict[str, Any]) -> None:
        assert self._redis is not None
        try:
            await self._redis.publish(
                self._channel,
                json.dumps(payload, default=str),
            )
        except Exception:
            # Локальная доставка уже выполнена — даже если Redis недоступен,
            # пользователи на этом же воркере увидят событие.
            logger.exception(
                "realtime: redis publish failed (event delivered locally only)"
            )

    # === listener (background) =============================================

    async def start_listener(self) -> None:
        """Запустить фоновую корутину, читающую Redis pub/sub.

        Идемпотентно: повторный вызов не создаст вторую таску. Без Redis-
        клиента ничего не делает (in-memory режим — listener не нужен).
        """
        if self._redis is None:
            return
        if self._listener_task is not None and not self._listener_task.done():
            return
        self._stopped = False
        self._listener_task = asyncio.create_task(
            self._listen(), name="realtime-bus-listener"
        )

    async def stop_listener(self) -> None:
        """Остановить фонового listener-а. Идемпотентно."""
        self._stopped = True
        task = self._listener_task
        self._listener_task = None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task

    async def _listen(self) -> None:
        """Слушаем Redis pub/sub и доставляем чужие события в локальные очереди.

        При любых ошибках соединения переподключаемся с экспоненциальным
        backoff-ом до 30с — чтобы при кратковременных сбоях Redis не терять
        все будущие события навсегда.
        """
        assert self._redis is not None
        backoff = 1.0
        while not self._stopped:
            pubsub = self._redis.pubsub()
            try:
                await pubsub.subscribe(self._channel)
                backoff = 1.0  # успешный коннект — сбрасываем backoff
                async for msg in pubsub.listen():
                    if self._stopped:
                        break
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("type") != "message":
                        continue
                    raw = msg.get("data")
                    if raw is None:
                        continue
                    try:
                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8")
                        event = json.loads(raw)
                    except Exception:
                        logger.exception("realtime: bad redis message, skipping")
                        continue
                    if not isinstance(event, dict):
                        continue
                    source = event.pop("_bus_source", None)
                    if source == self._source_id:
                        # Это событие пришло от нас же — мы его уже доставили
                        # локально в publish(). Не дублируем.
                        continue
                    self._deliver_local(event)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "realtime: listener crashed, reconnecting in %.1fs", backoff
                )
                try:
                    await asyncio.sleep(backoff)
                except asyncio.CancelledError:
                    raise
                backoff = min(backoff * 2, 30.0)
            finally:
                # Корректно закрыть pubsub. Любые ошибки игнорируем —
                # на этом этапе соединение уже могло быть оборвано.
                with contextlib.suppress(Exception):
                    await pubsub.unsubscribe(self._channel)
                with contextlib.suppress(Exception):
                    await pubsub.aclose()

    # === helpers for tests/migrations =======================================

    async def stream(
        self, q: asyncio.Queue[dict[str, Any]]
    ) -> AsyncIterator[dict[str, Any]]:
        while True:
            event = await q.get()
            yield event


_bus: EventBus | None = None


def get_bus() -> EventBus:
    """Lazy-singleton: один EventBus на процесс, подключен к общему Redis.

    Если Redis недоступен по какой-то причине при первом вызове — поднимем
    инстанс без него (логируем). Это даст хотя бы локальную доставку
    (как раньше), а listener сам поднимется как только мы вызовем
    `start_listener()` после восстановления Redis.
    """
    global _bus
    if _bus is None:
        try:
            from app.core.redis import get_redis

            _bus = EventBus(redis=get_redis())
        except Exception:
            logger.exception(
                "realtime: failed to obtain redis client, falling back to in-memory bus"
            )
            _bus = EventBus(redis=None)
    return _bus


def set_bus_for_tests(bus: EventBus | None) -> None:
    """Подменить singleton — только для тестов.

    Пробрасывание None сбросит singleton, и следующий `get_bus()` создаст
    новый. Полезно, чтобы тестовая фикстура могла подсунуть `fakeredis`
    через явный `EventBus(redis=fake_redis)`.
    """
    global _bus
    _bus = bus
