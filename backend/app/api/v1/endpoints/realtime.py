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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["realtime"])

# Раз в 30 секунд шлём приложение-уровневый ping, чтобы NAT/nginx-прокси
# не порвали соединение по бездействию.
_PING_INTERVAL_SECONDS = 30.0


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

    # Привет-сообщение, чтобы фронт мог отличить «подключились» от «ещё ждём».
    await websocket.send_json({"type": "hello", "userId": str(user.id)})

    async def _pump_events() -> None:
        try:
            while True:
                event: dict[str, Any] = await queue.get()
                await websocket.send_json(event)
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
        try:
            await websocket.close()
        except Exception:
            pass
