"""Online-presence store.

Хранит «кто сейчас онлайн» так, чтобы под `--workers > 1` все воркеры видели
один и тот же снапшот. Раньше тут был in-process `dict[str, int]`
(см. `endpoints/realtime.py::_online_connections`) — каждый воркер считал
только своих, поэтому метрика «онлайн пользователей» расходилась между
процессами и неверно учитывала второе/третье соединение пользователя,
если оно попало в другой воркер.

Решение — Redis (он уже есть в стеке под whitelist токенов и rate-limit):

* `crm:presence:online` — SET со строковыми user_id всех онлайн юзеров. Это
  то, что отдаём фронту в `hello.onlineUserIds`. Источник истины для snapshot.
* `crm:presence:conns:{user_id}` — Sorted Set, member = `connection_id`,
  score = unix-ts (секунды) истечения. WS-эндпоинт продлевает запись на каждом
  heartbeat-е. При штатном disconnect ZREM убирает соединение; если воркер
  упал — записи протухнут сами, а sweeper подметёт их позже.
* `EXPIRE crm:presence:conns:{user_id}` на `_TTL + _GRACE` секунд — чтобы при
  полном падении воркера и потере всех соединений ключ не висел вечно.

Все «опасные» переходы (became_online, became_offline) выполняются Lua-
скриптами — без них между `ZREM` и `ZCARD == 0` в другом воркере успел бы
проскочить новый коннект, и юзер ложно ушёл бы offline.

Fallback: если Redis-клиент не передан (тесты, или Redis недоступен в
момент старта), store работает по-старому через локальный dict с asyncio-
локом. Поведение для одного процесса остаётся прежним; для multi-worker
просто возвращаемся к старой проблеме (а не падаем).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Protocol

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


# Ключи Redis. Префикс совпадает с остальной realtime-подсистемой (crm:realtime).
_ONLINE_SET_KEY = "crm:presence:online"


def _conns_key(user_id: str) -> str:
    return f"crm:presence:conns:{user_id}"


# TTL одной записи «соединение живо» в секундах. Должно быть заметно больше
# `_PING_INTERVAL_SECONDS` (30с в endpoints/realtime.py) — иначе при едином
# пропуске одного heartbeat-а пользователь будет мигать offline/online.
_CONNECTION_TTL_SECONDS = 90
# Дополнительный запас для EXPIRE на родительский ключ — чтобы в худшем
# случае мёртвый ключ протух сам по себе, даже если sweeper тоже упал.
_CONNECTION_KEY_GRACE_SECONDS = 30


# === Lua-скрипты ============================================================
# Все скрипты идемпотентны и не предполагают, что воркер один — между нашими
# командами в Redis может вклиниться чужой ZADD/SADD.

# Connect: добавить соединение, продлить ключ, вернуть `1` если этот SADD
# реально добавил юзера в master-set (became_online), иначе `0`.
_LUA_CONNECT = """
local zkey = KEYS[1]
local online_set = KEYS[2]
local user_id = ARGV[1]
local conn_id = ARGV[2]
local expires_at = tonumber(ARGV[3])
local key_ttl = tonumber(ARGV[4])

redis.call('ZADD', zkey, expires_at, conn_id)
redis.call('EXPIRE', zkey, key_ttl)
return redis.call('SADD', online_set, user_id)
"""

# Heartbeat: продлить конкретное соединение и родительский ключ. Никаких
# изменений online-set не делает — на момент heartbeat пользователь уже был
# online (started от connect).
_LUA_HEARTBEAT = """
local zkey = KEYS[1]
local conn_id = ARGV[1]
local expires_at = tonumber(ARGV[2])
local key_ttl = tonumber(ARGV[3])

redis.call('ZADD', zkey, expires_at, conn_id)
redis.call('EXPIRE', zkey, key_ttl)
return 1
"""

# Disconnect: убрать соединение; если у юзера не осталось живых — снять его
# из online-set. Возвращаем `1` если только что сняли (became_offline), `0`
# если у юзера ещё есть другие соединения.
_LUA_DISCONNECT = """
local zkey = KEYS[1]
local online_set = KEYS[2]
local user_id = ARGV[1]
local conn_id = ARGV[2]

redis.call('ZREM', zkey, conn_id)
local remaining = redis.call('ZCARD', zkey)
if remaining == 0 then
    redis.call('DEL', zkey)
    return redis.call('SREM', online_set, user_id)
end
return 0
"""

# Sweep: пройтись по всем юзерам в master-set, выбросить из их sorted-set-ов
# протухшие соединения, и тех, у кого больше ничего не осталось — снять
# из master-set. Возвращаем список снятых user_id, чтобы вызывающий мог
# опубликовать presence.offline на каждого.
_LUA_SWEEP = """
local online_set = KEYS[1]
local prefix = KEYS[2]
local now = tonumber(ARGV[1])

local users = redis.call('SMEMBERS', online_set)
local removed = {}
for i = 1, #users do
    local uid = users[i]
    local zkey = prefix .. uid
    redis.call('ZREMRANGEBYSCORE', zkey, '-inf', now)
    local n = redis.call('ZCARD', zkey)
    if n == 0 then
        redis.call('DEL', zkey)
        redis.call('SREM', online_set, uid)
        removed[#removed + 1] = uid
    end
end
return removed
"""


class PresenceStore(Protocol):
    """Минимальный интерфейс presence-стора.

    Возвращаемые snapshot-ы — это список user_id (строк). Все методы
    идемпотентны: повторный connect одного и того же `connection_id`
    не даёт двойного увеличения, повторный disconnect неизвестного
    `connection_id` — no-op.
    """

    async def connect(
        self, user_id: str, connection_id: str
    ) -> tuple[list[str], bool]:
        """Зарегистрировать новое WS-соединение.

        Возвращает (snapshot, became_online), где snapshot — список всех
        онлайн юзеров (включая текущего).
        """
        ...

    async def heartbeat(self, user_id: str, connection_id: str) -> None:
        """Продлить TTL соединения. Тихий no-op, если запись не найдена."""
        ...

    async def disconnect(self, user_id: str, connection_id: str) -> bool:
        """Удалить соединение. Вернуть True, если юзер только что стал offline."""
        ...

    async def snapshot(self) -> list[str]:
        """Получить полный список онлайн юзеров (для healthcheck/debug)."""
        ...

    async def sweep(self) -> list[str]:
        """Удалить протухшие соединения. Вернуть user_id, ставших offline."""
        ...


# === In-memory реализация ===================================================


class _InMemoryPresenceStore:
    """Поведение как было до миграции на Redis: dict + asyncio-лок.

    Используется в тестах (фикстура без Redis) и как fallback, если по какой-то
    причине Redis недоступен на старте. TTL/heartbeat в этом режиме никого не
    интересует — соединения снимаются только через явный disconnect.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # user_id -> множество connection_id
        self._conns: dict[str, set[str]] = {}

    async def connect(
        self, user_id: str, connection_id: str
    ) -> tuple[list[str], bool]:
        async with self._lock:
            conns = self._conns.setdefault(user_id, set())
            became_online = len(conns) == 0
            conns.add(connection_id)
            snapshot = list(self._conns.keys())
            return snapshot, became_online

    async def heartbeat(self, user_id: str, connection_id: str) -> None:
        # В in-memory режиме нечего продлевать.
        return None

    async def disconnect(self, user_id: str, connection_id: str) -> bool:
        async with self._lock:
            conns = self._conns.get(user_id)
            if conns is None:
                return False
            conns.discard(connection_id)
            if not conns:
                self._conns.pop(user_id, None)
                return True
            return False

    async def snapshot(self) -> list[str]:
        async with self._lock:
            return list(self._conns.keys())

    async def sweep(self) -> list[str]:
        # In-memory режим не имеет TTL, мусор не накапливается.
        return []


# === Redis-реализация =======================================================


class _RedisPresenceStore:
    """Redis-backed presence store через Lua-скрипты.

    Скрипты регистрируются через `register_script`; redis-py кэширует SHA-1
    и сам вызовет `SCRIPT LOAD` при первом обращении / после рестарта Redis.
    """

    def __init__(
        self,
        redis: Redis,
        *,
        connection_ttl_seconds: int = _CONNECTION_TTL_SECONDS,
        key_grace_seconds: int = _CONNECTION_KEY_GRACE_SECONDS,
        online_set_key: str = _ONLINE_SET_KEY,
        conns_key_prefix: str = "crm:presence:conns:",
    ) -> None:
        self._redis = redis
        self._connection_ttl = connection_ttl_seconds
        self._key_ttl = connection_ttl_seconds + key_grace_seconds
        self._online_set_key = online_set_key
        self._conns_key_prefix = conns_key_prefix
        self._connect = redis.register_script(_LUA_CONNECT)
        self._heartbeat = redis.register_script(_LUA_HEARTBEAT)
        self._disconnect = redis.register_script(_LUA_DISCONNECT)
        self._sweep = redis.register_script(_LUA_SWEEP)

    def _now_ts(self) -> int:
        return int(time.time())

    def _expires_at(self) -> int:
        return self._now_ts() + self._connection_ttl

    async def connect(
        self, user_id: str, connection_id: str
    ) -> tuple[list[str], bool]:
        zkey = f"{self._conns_key_prefix}{user_id}"
        added = await self._connect(
            keys=[zkey, self._online_set_key],
            args=[user_id, connection_id, self._expires_at(), self._key_ttl],
        )
        snapshot = await self._redis.smembers(self._online_set_key)
        # redis-py с decode_responses=True вернёт set[str]; на всякий случай —
        # каст, чтобы не таскать в код set/bytes неожиданностей.
        snapshot_list = [
            s.decode("utf-8") if isinstance(s, bytes) else str(s)
            for s in snapshot
        ]
        return snapshot_list, bool(int(added))

    async def heartbeat(self, user_id: str, connection_id: str) -> None:
        zkey = f"{self._conns_key_prefix}{user_id}"
        await self._heartbeat(
            keys=[zkey],
            args=[connection_id, self._expires_at(), self._key_ttl],
        )

    async def disconnect(self, user_id: str, connection_id: str) -> bool:
        zkey = f"{self._conns_key_prefix}{user_id}"
        removed = await self._disconnect(
            keys=[zkey, self._online_set_key],
            args=[user_id, connection_id],
        )
        return bool(int(removed))

    async def snapshot(self) -> list[str]:
        ids = await self._redis.smembers(self._online_set_key)
        return [
            s.decode("utf-8") if isinstance(s, bytes) else str(s) for s in ids
        ]

    async def sweep(self) -> list[str]:
        result = await self._sweep(
            keys=[self._online_set_key, self._conns_key_prefix],
            args=[self._now_ts()],
        )
        # Lua возвращает array, redis-py отдаёт list[str|bytes].
        return [
            s.decode("utf-8") if isinstance(s, bytes) else str(s)
            for s in (result or [])
        ]


# === Singleton + sweeper ====================================================

_store: PresenceStore | None = None
_sweeper_task: asyncio.Task[None] | None = None
_sweeper_stopped = False
# Как часто sweeper проходит по списку. Стоит держать раз в 2× меньше TTL,
# чтобы протухшие записи не «зависали» дольше одного TTL-периода.
_SWEEPER_INTERVAL_SECONDS = 15.0


def get_presence_store() -> PresenceStore:
    """Lazy-singleton: один store на процесс. Если Redis недоступен —
    fallback на in-memory (логируем). Полностью повторяет логику get_bus().
    """
    global _store
    if _store is None:
        try:
            from app.core.redis import get_redis

            _store = _RedisPresenceStore(get_redis())
        except Exception:
            logger.exception(
                "presence: failed to obtain redis client, falling back to in-memory store"
            )
            _store = _InMemoryPresenceStore()
    return _store


def set_presence_store_for_tests(store: PresenceStore | None) -> None:
    """Подменить singleton — только для тестов.

    None сбросит singleton, следующий get_presence_store() создаст новый.
    """
    global _store
    _store = store


async def start_sweeper(*, on_offline=None) -> None:
    """Запустить фоновую таску, периодически чистящую протухшие соединения.

    `on_offline` — coroutine-callback `(user_id) -> None`, вызывается для
    каждого user_id, ставшего offline в результате чистки. По умолчанию —
    публикация `user.presence` события (см. endpoints/realtime.py::_lifespan
    setup). Идемпотентно: повторный вызов не создаст вторую таску.
    """
    global _sweeper_task, _sweeper_stopped
    if _sweeper_task is not None and not _sweeper_task.done():
        return
    _sweeper_stopped = False

    async def _loop() -> None:
        # Небольшой джиттер на старт, чтобы воркеры не сходились в одну
        # секунду (несколько uvicorn-воркеров запускаются почти одновременно).
        try:
            await asyncio.sleep(_SWEEPER_INTERVAL_SECONDS / 2)
        except asyncio.CancelledError:
            return
        while not _sweeper_stopped:
            try:
                store = get_presence_store()
                offlined = await store.sweep()
                if offlined and on_offline is not None:
                    for uid in offlined:
                        try:
                            await on_offline(uid)
                        except Exception:
                            logger.exception(
                                "presence: on_offline callback failed for %s", uid
                            )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("presence: sweeper iteration failed")
            try:
                await asyncio.sleep(_SWEEPER_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                return

    _sweeper_task = asyncio.create_task(_loop(), name="presence-sweeper")


async def stop_sweeper() -> None:
    """Остановить sweeper. Идемпотентно."""
    global _sweeper_task, _sweeper_stopped
    _sweeper_stopped = True
    task = _sweeper_task
    _sweeper_task = None
    if task is None:
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass


__all__ = [
    "PresenceStore",
    "get_presence_store",
    "set_presence_store_for_tests",
    "start_sweeper",
    "stop_sweeper",
]
