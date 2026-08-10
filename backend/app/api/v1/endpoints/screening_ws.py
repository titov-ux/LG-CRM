"""WebSocket /ws/screening/{session_id} — realtime-аудио → STT → транскрипт.

Авторизация как у /ws/events: `?token=<access jwt>`.

Клиент → сервер:
  - JSON control: {type:"start"|"stop"}
  - binary: 1 байт канала (0=recruiter, 1=candidate) + PCM16LE 16 кГц

Сервер → клиент:
  - hello {sessionId, lastSeq, sttReady}
  - transcript.partial / transcript.final {speaker, text, startedMs, endedMs, seq?}
  - session.state {status, sttReady?, error?}
  - ping каждые 30 с
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_token
from app.db.session import SessionLocal
from app.modules.screening import service as screening_service
from app.modules.screening.models import ScreeningSession, ScreeningSpeaker, ScreeningStatus
from app.modules.screening.stt_bridge import SttBridge
from app.modules.users.models import Role, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["screening-realtime"])

_PING_INTERVAL_SECONDS = 30.0


async def _authenticate(token: str) -> User | None:
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


def _can_stream(user: User, session: ScreeningSession) -> bool:
    """Стримить аудио может ведущий рекрутер или admin (как _ensure_can_edit)."""
    return user.role == Role.admin or session.recruiter_id == user.id


@router.websocket("/screening/{session_id}")
async def screening_ws(
    websocket: WebSocket,
    session_id: uuid.UUID,
    token: str = Query(default=""),
) -> None:
    user = await _authenticate(token) if token else None
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with SessionLocal() as db:
        session = await db.get(ScreeningSession, session_id)
        if (
            session is None
            or not _can_stream(user, session)
            or session.status != ScreeningStatus.live
        ):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        last_seq = await screening_service.next_seq(db, session_id) - 1

    await websocket.accept()

    settings = get_settings()
    stt_url = (settings.stt_url or "").strip()
    stt_ready = bool(stt_url)

    await websocket.send_json(
        {
            "type": "hello",
            "sessionId": str(session_id),
            "lastSeq": last_seq,
            "sttReady": stt_ready,
        }
    )

    bridge: SttBridge | None = None
    outgoing: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    stop_requested = False

    async def _on_stt_event(msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "transcript.final":
            speaker_raw = msg.get("speaker")
            text = (msg.get("text") or "").strip()
            if not text or speaker_raw not in ("recruiter", "candidate"):
                return
            try:
                started_ms = int(msg.get("startedMs") or 0)
                ended_ms = int(msg.get("endedMs") or started_ms)
                async with SessionLocal() as db:
                    seg = await screening_service.append_segment(
                        db,
                        session_id,
                        speaker=ScreeningSpeaker(speaker_raw),
                        text=text,
                        started_ms=started_ms,
                        ended_ms=ended_ms,
                    )
                await outgoing.put(
                    {
                        "type": "transcript.final",
                        "seq": seg.seq,
                        "speaker": speaker_raw,
                        "text": text,
                        "startedMs": started_ms,
                        "endedMs": ended_ms,
                        "latencyMs": msg.get("latencyMs"),
                    }
                )
            except Exception:
                logger.exception("screening_ws: failed to persist segment")
        elif kind == "transcript.partial":
            await outgoing.put(
                {
                    "type": "transcript.partial",
                    "speaker": msg.get("speaker"),
                    "text": msg.get("text"),
                }
            )
        elif kind == "stt.error":
            await outgoing.put(
                {
                    "type": "session.state",
                    "status": "live",
                    "sttReady": False,
                    "error": msg.get("error", "stt_error"),
                }
            )

    if stt_ready:
        try:
            bridge = SttBridge(stt_url, _on_stt_event)
            await bridge.connect()
        except Exception:
            logger.exception("screening_ws: cannot connect to STT at %s", stt_url)
            bridge = None
            stt_ready = False
            await websocket.send_json(
                {
                    "type": "session.state",
                    "status": "live",
                    "sttReady": False,
                    "error": "stt_unavailable",
                }
            )

    async def _pump_out() -> None:
        while True:
            msg = await outgoing.get()
            if msg is None:
                return
            await websocket.send_json(msg)

    async def _heartbeat() -> None:
        while True:
            await asyncio.sleep(_PING_INTERVAL_SECONDS)
            await websocket.send_json({"type": "ping"})

    async def _drain_in() -> None:
        nonlocal bridge, stop_requested
        while True:
            event = await websocket.receive()
            if event["type"] == "websocket.disconnect":
                raise WebSocketDisconnect()
            if "bytes" in event and event["bytes"] is not None:
                raw: bytes = event["bytes"]
                if bridge is not None and bridge.connected:
                    await bridge.send_pcm(raw)
            elif "text" in event and event["text"] is not None:
                try:
                    data = json.loads(event["text"])
                except (ValueError, TypeError):
                    continue
                if not isinstance(data, dict):
                    continue
                if data.get("type") == "stop":
                    stop_requested = True
                    if bridge is not None:
                        await bridge.stop()
                        bridge = None
                    await websocket.send_json(
                        {"type": "session.state", "status": "stopping"}
                    )
                    return

    tasks = [
        asyncio.create_task(_pump_out(), name="screening_out"),
        asyncio.create_task(_heartbeat(), name="screening_hb"),
        asyncio.create_task(_drain_in(), name="screening_in"),
    ]

    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        for t in pending:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        for t in done:
            if t.cancelled():
                continue
            exc = t.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                logger.exception("screening_ws task failed", exc_info=exc)
    finally:
        try:
            await outgoing.put(None)
        except Exception:
            pass
        if bridge is not None:
            # При обрыве сети — просто закрываем STT; сессия остаётся live
            # (клиент переподключится с backoff). stop_requested уже вызвал stop().
            if not stop_requested:
                await bridge.close()
            else:
                await bridge.close()
        try:
            await websocket.close()
        except Exception:
            pass
