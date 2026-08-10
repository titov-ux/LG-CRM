"""stt-service — realtime STT для AI-скрининга (Этап 2+).

WebSocket-сервер: PCM16LE 16 кГц + байт канала → VAD → Whisper (или fake).

ENV: STT_MODEL, STT_DEVICE, STT_COMPUTE_TYPE, STT_CPU_THREADS, STT_PORT,
     STT_FAKE, STT_MAX_SESSIONS (Этап 6 — пул параллельных встреч).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

SAMPLE_RATE = 16000
SPEAKERS = {0: "recruiter", 1: "candidate"}

MIN_SILENCE_MS = 600
PARTIAL_EVERY_S = 3.0
MIN_SEGMENT_S = 0.4
MAX_OPEN_SEGMENT_S = 25.0
# Energy-VAD (fake-режим без Silero): порог RMS и окно тишины.
ENERGY_THRESHOLD = 0.015
ENERGY_FRAME_MS = 30

logger = logging.getLogger("stt")

# Этап 6: лимит параллельных WS-сессий (одна встреча = одно соединение).
_active_sessions = 0
_active_lock: asyncio.Lock | None = None


def _get_active_lock() -> asyncio.Lock:
    global _active_lock
    if _active_lock is None:
        _active_lock = asyncio.Lock()
    return _active_lock


class FakeModel:
    """Заглушка: без скачивания Whisper. Для CI / локального пайплайна."""

    def transcribe(self, audio, **_kw):
        dur = len(audio) / SAMPLE_RATE

        class Seg:
            def __init__(self, text: str):
                self.text = text

        return iter([Seg(f"[fake {dur:.1f}s]")]), None


def load_model(args: argparse.Namespace):
    if args.fake:
        logger.info("STT_FAKE=1 — заглушка вместо Whisper")
        return FakeModel()
    from faster_whisper import WhisperModel

    logger.info(
        "Загружаю faster-whisper %s (%s/%s)…",
        args.model,
        args.device,
        args.compute_type,
    )
    return WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=args.cpu_threads,
    )


def _energy_vad(buf: np.ndarray) -> list[dict]:
    """Простой energy-VAD для fake-режима (без Silero/torch)."""
    frame = max(1, int(SAMPLE_RATE * ENERGY_FRAME_MS / 1000))
    regions: list[dict] = []
    start = None
    for i in range(0, len(buf) - frame + 1, frame):
        rms = float(np.sqrt(np.mean(buf[i : i + frame] ** 2)))
        if rms >= ENERGY_THRESHOLD:
            if start is None:
                start = i
        elif start is not None:
            regions.append({"start": start, "end": i})
            start = None
    if start is not None:
        regions.append({"start": start, "end": len(buf)})
    return regions


def _silero_vad(buf: np.ndarray) -> list[dict]:
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    return get_speech_timestamps(
        buf, VadOptions(min_silence_duration_ms=MIN_SILENCE_MS)
    )


class ChannelTranscriber:
    def __init__(self, speaker, model, executor, emit, loop, *, use_silero: bool):
        self.speaker = speaker
        self.model = model
        self.executor = executor
        self.emit = emit
        self.loop = loop
        self.use_silero = use_silero
        self.buf = np.zeros(0, dtype=np.float32)
        self.buf_start_ms = 0.0
        self.total_ms = 0.0
        self.last_partial_at = 0.0
        self.finals: list[float] = []
        self.recv_wallclock_ms = None
        self._partial_task = None

    def feed(self, pcm_bytes: bytes) -> None:
        chunk = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buf = np.concatenate([self.buf, chunk])
        self.total_ms += len(chunk) / SAMPLE_RATE * 1000
        self.recv_wallclock_ms = time.monotonic() * 1000

    def _transcribe(self, audio) -> str:
        segments, _ = self.model.transcribe(
            audio,
            language="ru",
            beam_size=1,
            condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments).strip()

    async def tick(self) -> None:
        if len(self.buf) < SAMPLE_RATE // 2:
            return
        vad = _silero_vad(self.buf) if self.use_silero else _energy_vad(self.buf)
        if not vad:
            keep = SAMPLE_RATE // 2
            if len(self.buf) > keep:
                cut = len(self.buf) - keep
                self.buf = self.buf[cut:]
                self.buf_start_ms += cut / SAMPLE_RATE * 1000
            return

        buf_end = len(self.buf)
        last = vad[-1]
        silence_after_last = (buf_end - last["end"]) / SAMPLE_RATE * 1000
        open_speech = None

        if silence_after_last < MIN_SILENCE_MS:
            open_speech = last
            closed = vad[:-1]
            open_dur = (buf_end - last["start"]) / SAMPLE_RATE
            if open_dur > MAX_OPEN_SEGMENT_S:
                closed = vad
                open_speech = None
        else:
            closed = vad

        for region in closed:
            await self._finalize(region)

        if closed:
            cut = closed[-1]["end"]
            self.buf = self.buf[cut:]
            self.buf_start_ms += cut / SAMPLE_RATE * 1000

        if open_speech is not None:
            now = time.monotonic()
            idle = self._partial_task is None or self._partial_task.done()
            if now - self.last_partial_at > PARTIAL_EVERY_S and idle:
                self.last_partial_at = now
                start = open_speech["start"] - (closed[-1]["end"] if closed else 0)
                seg = self.buf[int(max(start, 0)) :].copy()
                self._partial_task = asyncio.create_task(self._partial(seg))

    async def _finalize(self, region) -> None:
        seg = self.buf[region["start"] : region["end"]]
        if len(seg) / SAMPLE_RATE < MIN_SEGMENT_S:
            return
        started_ms = self.buf_start_ms + region["start"] / SAMPLE_RATE * 1000
        ended_ms = self.buf_start_ms + region["end"] / SAMPLE_RATE * 1000
        t0 = time.monotonic() * 1000
        text = await self.loop.run_in_executor(
            self.executor, self._transcribe, seg.copy()
        )
        if not text:
            return
        now_ms = time.monotonic() * 1000
        audio_lag_ms = self.total_ms - ended_ms
        latency_ms = (now_ms - (self.recv_wallclock_ms or now_ms)) + audio_lag_ms
        self.finals.append(latency_ms)
        await self.emit(
            {
                "type": "transcript.final",
                "speaker": self.speaker,
                "text": text,
                "startedMs": round(started_ms),
                "endedMs": round(ended_ms),
                "latencyMs": round(latency_ms),
                "transcribeMs": round(now_ms - t0),
            }
        )

    async def _partial(self, seg) -> None:
        if len(seg) / SAMPLE_RATE < 1.0:
            return
        text = await self.loop.run_in_executor(self.executor, self._transcribe, seg)
        if text:
            await self.emit(
                {
                    "type": "transcript.partial",
                    "speaker": self.speaker,
                    "text": text,
                }
            )

    def stats(self):
        if not self.finals:
            return None
        arr = sorted(self.finals)

        def pct(p: float) -> float:
            return arr[min(len(arr) - 1, int(len(arr) * p))]

        return {
            "speaker": self.speaker,
            "finals": len(arr),
            "latencyP50Ms": round(pct(0.50)),
            "latencyP95Ms": round(pct(0.95)),
            "latencyMaxMs": round(arr[-1]),
        }


async def handle(ws, model, executor, *, use_silero: bool, max_sessions: int) -> None:
    global _active_sessions
    loop = asyncio.get_running_loop()

    async def emit(payload: dict) -> None:
        try:
            await ws.send(json.dumps(payload, ensure_ascii=False))
        except Exception:
            pass

    lock = _get_active_lock()
    async with lock:
        if _active_sessions >= max_sessions:
            logger.warning(
                "stt busy: active=%d max=%d — rejecting",
                _active_sessions,
                max_sessions,
            )
            await emit(
                {
                    "type": "error",
                    "error": "busy",
                    "activeSessions": _active_sessions,
                    "maxSessions": max_sessions,
                }
            )
            try:
                await ws.close(code=1013, reason="stt_busy")
            except Exception:
                pass
            return
        _active_sessions += 1
        active_now = _active_sessions

    await emit(
        {
            "type": "hello",
            "sampleRate": SAMPLE_RATE,
            "activeSessions": active_now,
            "maxSessions": max_sessions,
        }
    )

    channels = {
        ch: ChannelTranscriber(sp, model, executor, emit, loop, use_silero=use_silero)
        for ch, sp in SPEAKERS.items()
    }

    async def ticker() -> None:
        while True:
            await asyncio.sleep(0.3)
            for c in channels.values():
                try:
                    await c.tick()
                except Exception:
                    logger.exception("stt tick failed for %s", c.speaker)

    task = asyncio.create_task(ticker())
    peer = getattr(ws, "remote_address", None)
    logger.info("client connected %s (active=%d/%d)", peer, active_now, max_sessions)
    try:
        async for msg in ws:
            if isinstance(msg, bytes):
                if len(msg) < 2:
                    continue
                ch = msg[0]
                if ch in channels:
                    channels[ch].feed(msg[1:])
            else:
                try:
                    data = json.loads(msg)
                except (ValueError, TypeError):
                    continue
                if data.get("type") == "stop":
                    for c in channels.values():
                        await c.tick()
                    stats = [s for c in channels.values() if (s := c.stats())]
                    await emit({"type": "stats", "channels": stats})
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        async with lock:
            _active_sessions = max(0, _active_sessions - 1)
            left = _active_sessions
        logger.info(
            "client disconnected %s (active=%d/%d)", peer, left, max_sessions
        )


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    ap = argparse.ArgumentParser(description="CRM-LG stt-service")
    ap.add_argument("--model", default=os.getenv("STT_MODEL", "small"))
    ap.add_argument("--device", default=os.getenv("STT_DEVICE", "cpu"))
    ap.add_argument("--compute-type", default=os.getenv("STT_COMPUTE_TYPE", "int8"))
    ap.add_argument("--cpu-threads", type=int, default=int(os.getenv("STT_CPU_THREADS", "4")))
    ap.add_argument("--port", type=int, default=int(os.getenv("STT_PORT", "8765")))
    ap.add_argument(
        "--max-sessions",
        type=int,
        default=int(os.getenv("STT_MAX_SESSIONS", "8")),
        help="Макс. параллельных встреч (Этап 6)",
    )
    ap.add_argument(
        "--fake",
        action=argparse.BooleanOptionalAction,
        default=_env_bool("STT_FAKE", False),
    )
    args = ap.parse_args()

    import websockets

    model = load_model(args)
    use_silero = not args.fake
    workers = 4 if args.device == "cuda" else 2
    executor = ThreadPoolExecutor(max_workers=workers)
    max_sessions = max(1, args.max_sessions)

    async def _handler(ws):
        await handle(
            ws, model, executor, use_silero=use_silero, max_sessions=max_sessions
        )

    async def _health(connection, request):
        """GET /healthz → 200 (docker healthcheck / nginx)."""
        if request.path == "/healthz":
            body = (
                f'{{"ok":true,"activeSessions":{_active_sessions},'
                f'"maxSessions":{max_sessions}}}\n'
            )
            return connection.respond(200, body)
        return None

    async with websockets.serve(
        _handler,
        "0.0.0.0",
        args.port,
        max_size=2**22,
        process_request=_health,
    ):
        logger.info(
            "stt-service listening ws://0.0.0.0:%s (model=%s max_sessions=%d)",
            args.port,
            "FAKE" if args.fake else args.model,
            max_sessions,
        )
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
