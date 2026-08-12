"""Офлайн-распознавание прикреплённой записи скрининга.

Запись в S3 — то, что собрал MediaRecorder в комнате. С Этапа 7 это **стерео**:
канал 0 — микрофон рекрутёра, канал 1 — звук вкладки (кандидат), поэтому роли в
транскрипте берутся из дорожек, без диаризации. Старые записи моно — там всё
уходит как `candidate`, как и раньше.

Декод через ffmpeg → PCM16LE 16 кГц по дорожкам, затем стрим в stt-service в
режиме `batch` (см. services/stt/server.py): без потолка буфера, окнами по
границам тишины, с таймингами от самого Whisper.
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
from typing import Any

from app.modules.screening.stt_bridge import SttBridge

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
# Каналы stt-service (см. SPEAKERS): 0 — рекрутёр, 1 — кандидат.
_CHANNEL_RECRUITER = 0
_CHANNEL_CANDIDATE = 1
# ~100 мс PCM16 mono.
_CHUNK_BYTES = SAMPLE_RATE // 10 * 2
_FFMPEG_TIMEOUT_SEC = 300
_FFPROBE_TIMEOUT_SEC = 30
# Больше двух дорожек нам не нужно: пишем ровно микрофон + вкладку.
_MAX_CHANNELS = 2


class OfflineSttError(Exception):
    """Не удалось получить транскрипт из файла."""


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def probe_channels(audio: bytes) -> int:
    """Сколько дорожек в записи. 1 — старое моно, 2 — стерео (микрофон/вкладка).

    Ошибка ffprobe не фатальна: считаем моно и распознаём как раньше — это
    хуже по ролям, но лучше, чем уронить всё распознавание.
    """
    if not shutil.which("ffprobe"):
        return 1
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-hide_banner",
                "-loglevel",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=channels",
                "-of",
                "json",
                "pipe:0",
            ],
            input=audio,
            capture_output=True,
            timeout=_FFPROBE_TIMEOUT_SEC,
            check=False,
        )
        if proc.returncode != 0:
            return 1
        streams = (json.loads(proc.stdout or b"{}") or {}).get("streams") or []
        channels = int((streams[0] if streams else {}).get("channels") or 1)
    except Exception:  # noqa: BLE001 — любая беда ffprobe = считаем моно
        logger.warning("offline_stt: ffprobe не определил дорожки — считаем моно")
        return 1
    return max(1, min(channels, _MAX_CHANNELS))


def _decode(audio: bytes, *, pan: str | None) -> bytes:
    """ffmpeg: произвольный контейнер → PCM16LE mono 16 кГц.

    `pan` вытаскивает одну дорожку из стерео (`c0=c0` / `c0=c1`). Два отдельных
    прогона вместо деинтерливинга руками: без numpy в бэкенде и без риска
    разъехаться на нечётной длине.
    """
    if not ffmpeg_available():
        raise OfflineSttError("ffmpeg не найден на сервере — офлайн-STT недоступен")
    if not audio:
        raise OfflineSttError("пустой аудиофайл")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0"]
    if pan:
        cmd += ["-af", f"pan=mono|{pan}"]
    cmd += [
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "pipe:1",
    ]
    try:
        proc = subprocess.run(
            cmd,
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


def webm_to_pcm16(audio: bytes) -> bytes:
    """Совместимость: сведённый в моно PCM всей записи."""
    return _decode(audio, pan=None)


def decode_tracks(audio: bytes) -> dict[int, bytes]:
    """`{канал stt: PCM16}`. Стерео → рекрутёр + кандидат, моно → кандидат."""
    if probe_channels(audio) >= 2:
        try:
            return {
                _CHANNEL_RECRUITER: _decode(audio, pan="c0=c0"),
                _CHANNEL_CANDIDATE: _decode(audio, pan="c0=c1"),
            }
        except OfflineSttError:
            # Стерео-декод не задался (битый заголовок, тишина в дорожке) —
            # не теряем запись целиком, распознаём микс как моно.
            logger.warning("offline_stt: стерео-декод не удался — читаем как моно")
    return {_CHANNEL_CANDIDATE: _decode(audio, pan=None)}


def _audio_sec(pcm_len: int) -> float:
    return pcm_len / (SAMPLE_RATE * 2)


def _offline_stt_budget_sec(audio_sec: float) -> float:
    """Потолок на всю запись.

    Whisper small/int8 на CPU считает медленнее реального времени, а дорожек
    может быть две. Берём с большим запасом: задачу всё равно ограничивает
    celery `task_time_limit`, а преждевременный таймаут здесь означал бы
    выброшенные полчаса работы.
    """
    return max(900.0, audio_sec * 12.0 + 600.0)


def _offline_stats_wait_sec(audio_sec: float) -> float:
    """Ожидание stats после stop: в батче на stop дожимается последнее окно."""
    return max(300.0, audio_sec * 4.0 + 300.0)


async def transcribe_tracks_via_stt(
    tracks: dict[int, bytes], stt_url: str
) -> list[dict[str, Any]]:
    """Прогнать дорожки через stt-service в батч-режиме, вернуть сегменты."""
    if not stt_url.strip():
        raise OfflineSttError("STT_URL не задан")
    if not tracks:
        raise OfflineSttError("нечего распознавать: нет аудиодорожек")

    finals: list[dict[str, Any]] = []
    done = asyncio.Event()
    batch_ready = asyncio.Event()
    stt_error: str | None = None
    total_sec = max(_audio_sec(len(pcm)) for pcm in tracks.values())

    async def on_event(msg: dict[str, Any]) -> None:
        nonlocal stt_error
        t = msg.get("type")
        if t == "transcript.final":
            text = (msg.get("text") or "").strip()
            if text:
                finals.append(
                    {
                        "text": text,
                        "speaker": msg.get("speaker") or "candidate",
                        "startedMs": int(msg.get("startedMs") or 0),
                        "endedMs": int(msg.get("endedMs") or 0),
                    }
                )
        elif t == "mode":
            if msg.get("mode") == "batch":
                batch_ready.set()
        elif t == "stats":
            done.set()
        elif t in ("stt.error", "error"):
            stt_error = str(msg.get("error") or "stt_error")
            logger.warning("offline_stt: stt error %s", stt_error)
            batch_ready.set()
            done.set()

    async def _run() -> list[dict[str, Any]]:
        bridge = SttBridge(stt_url, on_event)
        try:
            await bridge.connect()
            await bridge.send_control({"type": "mode", "mode": "batch"})
            # Старый образ stt-service про режим не знает и не ответит — ждём
            # недолго и продолжаем: он просто отработает как realtime.
            try:
                await asyncio.wait_for(batch_ready.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                logger.warning(
                    "offline_stt: stt-service не подтвердил batch-режим "
                    "(старый образ?) — качество транскрипта будет хуже"
                )
            if stt_error:
                raise OfflineSttError(f"STT вернул ошибку: {stt_error}")
            # Дорожки идём вперемешку по времени: так пик памяти в stt-service
            # держится на одном окне, а не на всей второй дорожке.
            for offset in range(0, max(len(p) for p in tracks.values()), _CHUNK_BYTES):
                for channel, pcm in tracks.items():
                    chunk = pcm[offset : offset + _CHUNK_BYTES]
                    if len(chunk) % 2:
                        chunk = chunk[:-1]
                    if not chunk:
                        continue
                    # Темп не задаём: в батче сервер читает сокет ровно с той
                    # скоростью, с какой успевает считать, и тормозит нас сам.
                    await bridge.send_pcm(bytes([channel]) + chunk)
            await bridge.send_control({"type": "stop"})
            try:
                await asyncio.wait_for(
                    done.wait(), timeout=_offline_stats_wait_sec(total_sec)
                )
            except asyncio.TimeoutError:
                # Финалы могли уже прийти до stats — не падаем, если текст есть.
                if not finals:
                    raise OfflineSttError("таймаут ожидания ответа STT") from None
            if stt_error and not finals:
                raise OfflineSttError(f"STT вернул ошибку: {stt_error}")
            await asyncio.sleep(0.3)
        finally:
            await bridge.close()
        return finals

    try:
        return await asyncio.wait_for(
            _run(), timeout=_offline_stt_budget_sec(total_sec)
        )
    except asyncio.TimeoutError as exc:
        raise OfflineSttError("таймаут офлайн-STT (стрим или ответ завис)") from exc


async def transcribe_pcm_via_stt(pcm: bytes, stt_url: str) -> list[dict[str, Any]]:
    """Совместимость: одна моно-дорожка = кандидат."""
    return await transcribe_tracks_via_stt({_CHANNEL_CANDIDATE: pcm}, stt_url)


async def transcribe_audio_bytes(audio: bytes, stt_url: str) -> list[dict[str, Any]]:
    tracks = await asyncio.to_thread(decode_tracks, audio)
    logger.info(
        "offline_stt: дорожек %d, длительность %.0f с",
        len(tracks),
        max(_audio_sec(len(p)) for p in tracks.values()),
    )
    items = await transcribe_tracks_via_stt(tracks, stt_url)
    # Порядок отдачи между дорожками не гарантирован — сортируем по времени.
    items.sort(key=lambda x: (int(x.get("startedMs") or 0), int(x.get("endedMs") or 0)))
    return items
