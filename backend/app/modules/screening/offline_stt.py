"""Офлайн-распознавание прикреплённой записи скрининга.

Live-STT пишет сегменты с двух каналов (мик / вкладка). Запись в S3 —
сведённый mono `.webm`: диаризации нет, все реплики кладём как `candidate`.
Декод через ffmpeg → PCM16LE 16 кГц, затем стрим в существующий stt-service
по WebSocket (тот же протокол, что у живой встречи).
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from typing import Any

from app.modules.screening.stt_bridge import SttBridge

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
# Канал 1 = candidate в stt-service (см. SPEAKERS).
_CHANNEL_CANDIDATE = 1
# ~100 мс PCM16 mono.
_CHUNK_BYTES = SAMPLE_RATE // 10 * 2
_FFMPEG_TIMEOUT_SEC = 120


class OfflineSttError(Exception):
    """Не удалось получить транскрипт из файла."""


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def webm_to_pcm16(audio: bytes) -> bytes:
    """Декод произвольного аудио (webm/ogg/mp4/…) в PCM16LE mono 16 кГц."""
    if not ffmpeg_available():
        raise OfflineSttError("ffmpeg не найден на сервере — офлайн-STT недоступен")
    if not audio:
        raise OfflineSttError("пустой аудиофайл")
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "pipe:1",
            ],
            input=audio,
            capture_output=True,
            timeout=_FFMPEG_TIMEOUT_SEC,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise OfflineSttError("ffmpeg: таймаут декодирования записи") from exc
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", "replace").strip()
        raise OfflineSttError(f"ffmpeg не смог декодировать запись: {err or proc.returncode}")
    pcm = proc.stdout or b""
    if len(pcm) < SAMPLE_RATE:  # < 0.5 с
        raise OfflineSttError("после декодирования слишком короткий звук")
    # PCM16: чётная длина.
    if len(pcm) % 2:
        pcm = pcm[:-1]
    return pcm


def _offline_stt_budget_sec(pcm_len: int) -> float:
    """Верхняя граница: ~2× realtime + запас на connect/flush (не меньше 3 мин)."""
    audio_sec = pcm_len / (SAMPLE_RATE * 2)
    return max(180.0, audio_sec * 2.0 + 120.0)


async def transcribe_pcm_via_stt(pcm: bytes, stt_url: str) -> list[dict[str, Any]]:
    """Прогнать PCM через stt-service, вернуть финальные сегменты."""
    if not stt_url.strip():
        raise OfflineSttError("STT_URL не задан")

    finals: list[dict[str, Any]] = []
    done = asyncio.Event()

    async def on_event(msg: dict[str, Any]) -> None:
        t = msg.get("type")
        if t == "transcript.final":
            text = (msg.get("text") or "").strip()
            if text:
                finals.append(
                    {
                        "text": text,
                        "startedMs": int(msg.get("startedMs") or 0),
                        "endedMs": int(msg.get("endedMs") or 0),
                    }
                )
        elif t == "stats":
            done.set()
        elif t == "stt.error":
            logger.warning("offline_stt: stt error %s", msg.get("error"))
            done.set()

    async def _run() -> list[dict[str, Any]]:
        bridge = SttBridge(stt_url, on_event)
        try:
            await bridge.connect()
            for i in range(0, len(pcm), _CHUNK_BYTES):
                chunk = pcm[i : i + _CHUNK_BYTES]
                if len(chunk) % 2:
                    chunk = chunk[:-1]
                if not chunk:
                    continue
                await bridge.send_pcm(bytes([_CHANNEL_CANDIDATE]) + chunk)
                # Не забиваем event loop на длинных файлах.
                if i and i % (_CHUNK_BYTES * 50) == 0:
                    await asyncio.sleep(0)
            await bridge.send_control({"type": "stop"})
            try:
                await asyncio.wait_for(done.wait(), timeout=120.0)
            except asyncio.TimeoutError:
                # Финалы могли уже прийти до stats — не падаем, если текст есть.
                if not finals:
                    raise OfflineSttError("таймаут ожидания ответа STT") from None
            await asyncio.sleep(0.3)
        finally:
            await bridge.close()
        return finals

    try:
        return await asyncio.wait_for(_run(), timeout=_offline_stt_budget_sec(len(pcm)))
    except asyncio.TimeoutError as exc:
        raise OfflineSttError("таймаут офлайн-STT (стрим или ответ завис)") from exc


async def transcribe_audio_bytes(audio: bytes, stt_url: str) -> list[dict[str, Any]]:
    pcm = await asyncio.to_thread(webm_to_pcm16, audio)
    return await transcribe_pcm_via_stt(pcm, stt_url)
