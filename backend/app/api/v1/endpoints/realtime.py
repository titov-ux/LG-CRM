"""WebSocket-эндпоинт /ws/events.

Браузер не умеет отправлять Authorization-заголовок при ws-handshake, поэтому
авторизуемся по access-токену в query-параметре `?token=<jwt>`. Токен короткий
(15 минут) и приходит по https/wss — это терпимо.

Сервер шлёт каждому подписчику JSON-события из app.realtime.bus, плюс
служебные `{"type": "ping"}` для keep-alive (за NAT / прокси / nginx).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import SessionLocal
from app.modules.users.models import User
from app.realtime.bus import get_bus
from app.realtime.events import publish_user_presence_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["realtime"])

# Раз в 30 секунд шлём приложение-уровневый ping, чтобы NAT/nginx-прокси
# не порвали соединение по бездействию.
_PING_INTERVAL_SECONDS = 30.0
_presence_lock = asyncio.Lock()
_online_connections: dict[str, int] = {}


def _snapshot_online_user_ids() -> list[str]:
    return list(_online_connections.keys())


async def _mark_user_connected(user_id: uuid.UUID) -> tuple[list[str], bool]:
    """Увеличить счётчик соединений user-а, вернуть (snapshot, became_online)."""
    user_id_str = str(user_id)
    async with _presence_lock:
        before = _online_connections.get(user_id_str, 0)
        _online_connections[user_id_str] = before + 1
        return _snapshot_online_user_ids(), before == 0


async def _mark_user_disconnected(user_id: uuid.UUID) -> bool:
    """Уменьшить счётчик соединений user-а, вернуть became_offline."""
    user_id_str = str(user_id)
    async with _presence_lock:
        before = _online_connections.get(user_id_str, 0)
        if before <= 1:
            _online_connections.pop(user_id_str, None)
            return before > 0
        _online_connections[user_id_str] = before - 1
        return False


async def _authenticate(token: str) -> User | None:
    """Расшифровать access-токен и достать активного пользователя из БД."""
    try:
        payload = decode_token(token)
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != "access":
        return None
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        return None

    async with SessionLocal() as db:  # type: AsyncSession
        user = (
            await db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            return None
        return user


@router.websocket("/events")
async def events(
    websocket: WebSocket,
    token: str = Query(default=""),
) -> None:
    user = await _authenticate(token) if token else None
    if user is None:
        # 4401 — пользовательский код «unauthorized», принят в community.
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    bus = get_bus()
    queue = await bus.subscribe()
    online_snapshot, became_online = await _mark_user_connected(user.id)

    # Привет-сообщение, чтобы фронт мог отличить «подключились» от «ещё ждём».
    await websocket.send_json(
        {
            "type": "hello",
            "userId": str(user.id),
            "onlineUserIds": online_snapshot,
        }
    )
    if became_online:
        publish_user_presence_event(user_id=user.id, online=True)

    async def _pump_events() -> None:
        # Фильтрация по audience: если в событии явно перечислена аудитория
        # (приватные чат-события), отдаём его только тем, кто в этом списке.
        # События без `audience` остаются как раньше — рассылаются всем (так
        # ведут себя vacancy.changed / candidate.changed).
        user_id_str = str(user.id)
        try:
            while True:
                event: dict[str, Any] = await queue.get()
                audience = event.get("audience")
                if audience is not None and user_id_str not in audience:
                    continue
                # `audience` — служебное поле бэка, фронту его знать не нужно
                # (плюс это user_id других людей — лишний leak). Шлём копию
                # без него.
                if audience is None:
                    await websocket.send_json(event)
                else:
                    payload = {k: v for k, v in event.items() if k != "audience"}
                    await websocket.send_json(payload)
        except WebSocketDisconnect:
            raise
        except Exception:
            logger.exception("realtime: pump_events crashed")
            raise

    async def _heartbeat() -> None:
        # Не используем websocket.ping() (низкоуровневый, не во всех клиентах
        # триггерит обработчик) — шлём свой JSON-«ping», его читает фронт.
        try:
            while True:
                await asyncio.sleep(_PING_INTERVAL_SECONDS)
                await websocket.send_json({"type": "ping"})
        except WebSocketDisconnect:
            raise
        except Exception:
            logger.exception("realtime: heartbeat crashed")
            raise

    async def _drain_incoming() -> None:
        # Мы не ждём от клиента полезной нагрузки, но обязаны читать сообщения,
        # иначе библиотека не заметит отключения. Любой получённый текст
        # игнорируем (можно использовать как «client pong», тоже норм).
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            raise

    tasks = [
        asyncio.create_task(_pump_events()),
        asyncio.create_task(_heartbeat()),
        asyncio.create_task(_drain_incoming()),
    ]

    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for t in pending:
            t.cancel()
        # Дожидаемся отменённых, чтобы не оставлять «висящих» тасок.
        for t in pending:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
    finally:
        await bus.unsubscribe(queue)
        became_offline = await _mark_user_disconnected(user.id)
        if became_offline:
            publish_user_presence_event(user_id=user.id, online=False)
        try:
            await websocket.close()
        except Exception:
            pass
