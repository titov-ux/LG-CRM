"""WebSocket /ws/screening/{session_id} — realtime-аудио → STT → транскрипт + агент.

Авторизация как у /ws/events: `?token=<access jwt>`.
Право `screening:run` — через permissions-matrix (Этап 6).

Клиент → сервер:
  - JSON control: {type:"start"|"stop"}
  - binary: 1 байт канала (0=recruiter, 1=candidate) + PCM16LE 16 кГц

Сервер → клиент:
  - hello {sessionId, lastSeq, sttReady, maxDurationSec}
  - transcript.partial / transcript.final {speaker, text, startedMs, endedMs, seq?}
  - questions.updated {questions[]} — чек-лист после тика realtime-агента (Этап 4)
  - hint {text} — короткая подсказка рекрутеру
  - session.state {status, sttReady?, error?} — в т.ч. error=max_duration (Этап 6)
  - ping каждые 30 с
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_token
from app.db.session import SessionLocal
from app.modules.permissions import service as permissions_service
from app.modules.screening import metrics as screening_metrics
from app.modules.screening import service as screening_service
from app.modules.screening.agent import ScreeningRealtimeAgent
from app.modules.screening.models import ScreeningSession, ScreeningSpeaker, ScreeningStatus
from app.modules.screening.stt_bridge import SttBridge
from app.modules.users.models import Role, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["screening-realtime"])

_PING_INTERVAL_SECONDS = 30.0
_ACTION_RUN = "screening:run"


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

    started_at: datetime | None = None
    async with SessionLocal() as db:
        session = await db.get(ScreeningSession, session_id)
        if (
            session is None
            or not _can_stream(user, session)
            or session.status != ScreeningStatus.live
        ):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        if not await permissions_service.user_has_action(db, user, _ACTION_RUN):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        started_at = session.started_at
        last_seq = await screening_service.next_seq(db, session_id) - 1

    await websocket.accept()

    settings = get_settings()
    stt_url = (settings.stt_url or "").strip()
    stt_ready = bool(stt_url)
    max_duration_sec = max(0, int(settings.screening_max_duration_min) * 60)

    await websocket.send_json(
        {
            "type": "hello",
            "sessionId": str(session_id),
            "lastSeq": last_seq,
            "sttReady": stt_ready,
            "maxDurationSec": max_duration_sec,
        }
    )

    bridge: SttBridge | None = None
    outgoing: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    stop_requested = False
    timed_out = False

    async def _emit(msg: dict[str, Any]) -> None:
        await outgoing.put(msg)

    agent = ScreeningRealtimeAgent(session_id, _emit)

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
                latency_raw = msg.get("latencyMs")
                latency_ms = float(latency_raw) if latency_raw is not None else None
                async with SessionLocal() as db:
                    seg = await screening_service.append_segment(
                        db,
                        session_id,
                        speaker=ScreeningSpeaker(speaker_raw),
                        text=text,
                        started_ms=started_ms,
                        ended_ms=ended_ms,
                    )
                screening_metrics.record_stt_final(latency_ms)
                await outgoing.put(
                    {
                        "type": "transcript.final",
                        "seq": seg.seq,
                        "speaker": speaker_raw,
                        "text": text,
                        "startedMs": started_ms,
                        "endedMs": ended_ms,
                        "latencyMs": latency_raw,
                    }
                )
                agent.notify_final(seg.seq)
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
            reason = str(msg.get("error") or "stt_error")
            screening_metrics.record_stt_error(reason)
            await outgoing.put(
                {
                    "type": "session.state",
                    "status": "live",
                    "sttReady": False,
                    "error": reason,
                }
            )

    if stt_ready:
        try:
            bridge = SttBridge(stt_url, _on_stt_event)
            await bridge.connect()
        except Exception:
            logger.exception("screening_ws: cannot connect to STT at %s", stt_url)
            screening_metrics.record_stt_error("stt_unavailable")
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

    async def _duration_watch() -> None:
        """Hard-stop по SCREENING_MAX_DURATION_MIN (Этап 6)."""
        nonlocal timed_out
        max_min = int(settings.screening_max_duration_min)
        if max_min <= 0:
            await asyncio.Event().wait()
            return
        anchor = started_at or datetime.now(UTC)
        if anchor.tzinfo is None:
            anchor = anchor.replace(tzinfo=UTC)
        deadline = anchor + timedelta(minutes=max_min)
        while True:
            remaining = (deadline - datetime.now(UTC)).total_seconds()
            if remaining <= 0:
                break
            await asyncio.sleep(min(remaining, 15.0))
        timed_out = True
        try:
            await screening_service.finish_by_timeout(session_id)
        except Exception:
            logger.exception(
                "screening_ws: finish_by_timeout failed for %s", session_id
            )
        await outgoing.put(
            {
                "type": "session.state",
                "status": "processing",
                "error": "max_duration",
            }
        )
        # Даём клиенту получить событие, затем рвём входной цикл.
        await asyncio.sleep(0.3)
        raise WebSocketDisconnect(code=1000)

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
        asyncio.create_task(_duration_watch(), name="screening_duration"),
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
        await agent.close()
        try:
            await outgoing.put(None)
        except Exception:
            pass
        if bridge is not None:
            # При обрыве сети — просто закрываем STT; сессия остаётся live
            # (клиент переподключится с backoff). stop_requested / timeout
            # уже вызвали stop или finish_by_timeout.
            if not stop_requested and not timed_out:
                await bridge.close()
            else:
                await bridge.close()
        try:
            await websocket.close()
        except Exception:
            pass
