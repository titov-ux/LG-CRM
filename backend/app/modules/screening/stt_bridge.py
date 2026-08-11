"""Клиент к stt-service (WebSocket).

Backend проксирует PCM-фреймы браузера в STT и получает
transcript.partial / transcript.final. См. services/stt/server.py.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection

logger = logging.getLogger(__name__)

EmitFn = Callable[[dict[str, Any]], Awaitable[None]]


class SttBridge:
    """Одно WS-соединение к stt-service на одну комнату скрининга."""

    def __init__(self, url: str, on_event: EmitFn) -> None:
        self._url = url
        self._on_event = on_event
        self._ws: ClientConnection | None = None
        self._reader: asyncio.Task | None = None
        self._closed = False

    def set_handler(self, on_event: EmitFn) -> None:
        """Перепривязать получателя событий (переиспользование при reconnect WS)."""
        self._on_event = on_event

    @property
    def connected(self) -> bool:
        return self._ws is not None and not self._closed

    async def connect(self) -> None:
        self._ws = await websockets.connect(self._url, max_size=2**22, open_timeout=10)
        await self._ws.send(json.dumps({"type": "start", "sampleRate": 16000}))
        self._reader = asyncio.create_task(self._pump())

    async def send_pcm(self, frame: bytes) -> None:
        if self._ws is None or self._closed:
            return
        await self._ws.send(frame)

    async def send_control(self, payload: dict[str, Any]) -> None:
        if self._ws is None or self._closed:
            return
        await self._ws.send(json.dumps(payload))

    async def stop(self) -> None:
        """Попросить STT сбросить хвосты и закрыть соединение."""
        try:
            if self._ws is not None and not self._closed:
                await self.send_control({"type": "stop"})
                # Даём STT дослать финалы.
                await asyncio.sleep(0.8)
        except Exception:
            logger.exception("stt bridge: stop failed")
        await self.close()

    async def close(self) -> None:
        self._closed = True
        if self._reader is not None:
            self._reader.cancel()
            try:
                await self._reader
            except (asyncio.CancelledError, Exception):
                pass
            self._reader = None
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

    async def _pump(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    msg = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                if not isinstance(msg, dict):
                    continue
                # hello/stats от STT — служебные; error/busy — наверх как stt.error.
                if msg.get("type") == "error":
                    await self._on_event(
                        {
                            "type": "stt.error",
                            "error": msg.get("error", "stt_error"),
                        }
                    )
                    continue
                await self._on_event(msg)
        except asyncio.CancelledError:
            raise
        except Exception:
            if not self._closed:
                logger.exception("stt bridge: pump ended")
                # Помечаем мост мёртвым, иначе connected продолжает врать True
                # и следующая send_pcm рвёт WS рекрутера целиком.
                self._closed = True
                self._ws = None
                await self._on_event({"type": "stt.error", "error": "stt_disconnected"})
        else:
            # Штатное закрытие со стороны STT — тоже конец жизни моста.
            if not self._closed:
                self._closed = True
                self._ws = None
                await self._on_event({"type": "stt.error", "error": "stt_closed"})
