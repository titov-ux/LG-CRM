"""stt-service — realtime STT для AI-скрининга (Этап 2+).

WebSocket-сервер: PCM16LE 16 кГц + байт канала → VAD → Whisper (или fake).

Два режима на одном протоколе:
  * `live` (по умолчанию) — realtime-встреча: короткие сегменты, partial-ы,
    потолок буфера MAX_BUFFER_S (лучше потерять хвост, чем копить задержку);
  * `batch` — распознавание загруженной записи. Включается control-сообщением
    {"type":"mode","mode":"batch"} сразу после connect. Дропов нет: приём и
    транскрибация идут в одном цикле, отправителя тормозит TCP.

ENV: STT_MODEL, STT_DEVICE, STT_COMPUTE_TYPE, STT_CPU_THREADS, STT_PORT,
     STT_FAKE, STT_MAX_SESSIONS (Этап 6 — пул параллельных встреч),
     STT_BATCH_WINDOW_S, STT_BATCH_BEAM, STT_BATCH_PROMPT (офлайн-режим).
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
# Жёсткий потолок буфера канала. VAD подрезает буфер только когда находит речь
# и закрытые сегменты; при перегрузке (транскрибация не успевает, речь без пауз)
# буфер рос без границы — вместе с ним и задержка распознавания.
MAX_BUFFER_S = 30.0
# Не чаще раза в N секунд жалуемся в лог на переполнение (иначе спам на каждый кадр).
OVERFLOW_LOG_EVERY_S = 5.0
# Energy-VAD (fake-режим без Silero): порог RMS и окно тишины.
ENERGY_THRESHOLD = 0.015
ENERGY_FRAME_MS = 30

# --- batch (офлайн-распознавание записи) ----------------------------------
# Окно, которым режется запись. Больше окно — лучше контекст и меньше швов,
# но выше пик памяти (float32: 1 мин ≈ 3.8 МБ) и дольше первая выдача.
BATCH_WINDOW_S = 120.0
# Хвост тишины, который оставляем после последней речи в окне: режем ПО тишине,
# чтобы не рвать слово пополам и не ловить дубли на стыке окон.
BATCH_SPLIT_TAIL_S = 0.15
# Если после последней речи тишины меньше — режем по границе окна как есть.
BATCH_MIN_TAIL_S = 0.3

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
            def __init__(self, text: str, start: float = 0.0, end: float = 0.0):
                self.text = text
                # Батч-режим читает тайминги сегмента напрямую — у заглушки они
                # тоже должны быть, иначе fake-прогон падал бы на getattr.
                self.start = start
                self.end = end

        return iter([Seg(f"[fake {dur:.1f}s]", 0.0, dur)]), None


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
        self.dropped_ms = 0.0
        self._last_overflow_log = 0.0

    def feed(self, pcm_bytes: bytes) -> None:
        # Только дописываем в хвост. Обрезать буфер здесь НЕЛЬЗЯ: приём кадров и
        # ticker() — разные задачи, tick() считает регионы VAD по индексам этого
        # же буфера и уходит в run_in_executor. Срез головы на этом await сдвинул
        # бы данные под уже вычисленными region["start"]/["end"] — распознавался
        # бы не тот кусок, а startedMs/endedMs уехали бы. Потолок держит tick().
        chunk = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buf = np.concatenate([self.buf, chunk])
        self.total_ms += len(chunk) / SAMPLE_RATE * 1000
        self.recv_wallclock_ms = time.monotonic() * 1000

    async def after_feed(self) -> None:
        """Live-режим ничего не делает сразу после кадра — работает ticker()."""
        return None

    def _enforce_buffer_cap(self) -> None:
        """Потолок буфера: дропаем самое старое аудио и сдвигаем buf_start_ms.

        Зовётся только из tick(), синхронно, ДО вычисления VAD — в этот момент
        никаких «висящих» индексов регионов не существует. Иначе при перегрузке
        (STT медленнее реального времени) задержка растёт неограниченно.
        """
        max_len = int(SAMPLE_RATE * MAX_BUFFER_S)
        if len(self.buf) <= max_len:
            return
        cut = len(self.buf) - max_len
        self.buf = self.buf[cut:]
        cut_ms = cut / SAMPLE_RATE * 1000
        self.buf_start_ms += cut_ms
        self.dropped_ms += cut_ms
        now = time.monotonic()
        if now - self._last_overflow_log >= OVERFLOW_LOG_EVERY_S:
            self._last_overflow_log = now
            logger.warning(
                "stt: буфер %s переполнен (>%.0f с) — отброшено %.0f мс (всего %.0f мс)",
                self.speaker,
                MAX_BUFFER_S,
                cut_ms,
                self.dropped_ms,
            )

    def _transcribe(self, audio) -> str:
        segments, _ = self.model.transcribe(
            audio,
            language="ru",
            beam_size=1,
            condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments).strip()

    async def tick(self) -> None:
        # Подрезаем ДО вычисления VAD (см. _enforce_buffer_cap).
        self._enforce_buffer_cap()
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

    async def flush(self) -> None:
        """Дожать остаток буфера (control `stop` / закрытие соединения).

        В `tick` открытый VAD-регион ждёт MIN_SILENCE_MS тишины. Если встречу
        завершили сразу после реплики, этой тишины не будет и последняя фраза
        кандидата потеряется — здесь финализируем её принудительно.
        """
        if len(self.buf) == 0:
            return
        vad = _silero_vad(self.buf) if self.use_silero else _energy_vad(self.buf)
        cut = len(self.buf)
        for region in vad:
            await self._finalize(region)
        # Буфер отдан целиком (в т.ч. если VAD не нашёл речи — там тишина).
        self.buf = self.buf[cut:]
        self.buf_start_ms += cut / SAMPLE_RATE * 1000

    def cancel_tasks(self) -> None:
        """Снять незавершённые задачи транскрибации канала.

        Без этого после disconnect partial-таски продолжают занимать воркеры
        ThreadPoolExecutor и тормозят соседние сессии.
        """
        if self._partial_task is not None and not self._partial_task.done():
            self._partial_task.cancel()
        self._partial_task = None

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
            "droppedMs": round(self.dropped_ms),
            "latencyP50Ms": round(pct(0.50)),
            "latencyP95Ms": round(pct(0.95)),
            "latencyMaxMs": round(arr[-1]),
        }


class BatchTranscriber:
    """Офлайн-распознавание загруженной записи. Один канал = один спикер.

    Чем отличается от `ChannelTranscriber` и зачем вообще нужен отдельный класс:

    * **нет дропов.** Realtime-канал держит потолок `MAX_BUFFER_S` и выбрасывает
      самое старое аудио, когда Whisper не успевает за подачей. Для живой
      встречи это правильный размен (лучше потерять фразу, чем накапливать
      задержку), но для записи он означал дыры на половину интервью. Здесь приём
      кадра и транскрибация идут в одном цикле: пока считается окно, сокет не
      читается, и отправителя тормозит TCP-backpressure.
    * **честные тайминги.** Границы сегментов берём у самого faster-whisper
      (`segment.start/.end` + смещение окна), а не собираем из индексов буфера,
      который realtime-путь двигал при каждом дропе. Поэтому нет ни перепутанного
      порядка, ни дублей на стыках.
    * **качество вместо задержки.** `beam_size` > 1, `condition_on_previous_text`
      и `vad_filter` — в realtime это непозволительно дорого, в офлайне бесплатно.
    """

    def __init__(
        self,
        speaker,
        model,
        executor,
        emit,
        loop,
        *,
        use_silero: bool,
        window_s: float,
        beam_size: int,
        initial_prompt: str | None,
    ) -> None:
        self.speaker = speaker
        self.model = model
        self.executor = executor
        self.emit = emit
        self.loop = loop
        self.use_silero = use_silero
        self.window = max(int(SAMPLE_RATE * window_s), SAMPLE_RATE * 5)
        self.beam_size = beam_size
        self.initial_prompt = initial_prompt or None
        self.buf = np.zeros(0, dtype=np.float32)
        # Сколько аудио уже распознано и выброшено из буфера — смещение таймингов.
        self.offset_ms = 0.0
        self.total_ms = 0.0
        self.finals = 0
        self.transcribe_ms = 0.0

    def feed(self, pcm_bytes: bytes) -> None:
        chunk = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buf = np.concatenate([self.buf, chunk])
        self.total_ms += len(chunk) / SAMPLE_RATE * 1000

    async def after_feed(self) -> None:
        """Добить накопившиеся окна. Вызывается из цикла чтения — это и есть
        backpressure: пока мы тут считаем, клиент не может слить следующий кадр."""
        while len(self.buf) >= self.window:
            await self._consume(self._split_point())

    async def tick(self) -> None:
        """Батчу тикер не нужен — окна закрывает after_feed()/flush()."""
        return None

    def cancel_tasks(self) -> None:
        return None

    async def flush(self) -> None:
        """Хвост записи после control `stop` (или обрыва соединения)."""
        while len(self.buf) > 0:
            cut = self._split_point() if len(self.buf) > self.window else len(self.buf)
            await self._consume(cut)

    def _split_point(self) -> int:
        """Где резать окно: по последней границе речи, иначе ровно по окну.

        Резать посреди фразы нельзя — Whisper на обрывке выдумывает окончание,
        а на следующем окне повторяет ту же фразу целиком (те самые дубли
        «уделенное время, мы обязательно…» из realtime-выдачи).
        """
        head = self.buf[: self.window]
        try:
            vad = _silero_vad(head) if self.use_silero else _energy_vad(head)
        except Exception:  # noqa: BLE001 — VAD не критичен, режем по окну
            logger.exception("stt.batch: VAD не сработал для %s", self.speaker)
            return len(head)
        if not vad:
            # В окне одна тишина — отдавать её Whisper смысла нет.
            return len(head)
        end = int(vad[-1]["end"])
        if len(head) - end >= int(SAMPLE_RATE * BATCH_MIN_TAIL_S):
            return min(len(head), end + int(SAMPLE_RATE * BATCH_SPLIT_TAIL_S))
        return len(head)

    async def _consume(self, cut: int) -> None:
        cut = max(1, min(cut, len(self.buf)))
        window = self.buf[:cut].copy()
        base_ms = self.offset_ms
        # Двигаем буфер и смещение ДО await: следующий кадр может прийти в этот
        # же момент, и он должен лечь в хвост уже урезанного буфера.
        self.buf = self.buf[cut:]
        self.offset_ms += cut / SAMPLE_RATE * 1000
        started = time.monotonic()
        try:
            items = await self.loop.run_in_executor(
                self.executor, self._transcribe, window
            )
        except Exception:  # noqa: BLE001 — одно окно не должно ронять всю запись
            logger.exception("stt.batch: окно не распозналось (%s)", self.speaker)
            return
        self.transcribe_ms += (time.monotonic() - started) * 1000
        for start_s, end_s, text in items:
            self.finals += 1
            await self.emit(
                {
                    "type": "transcript.final",
                    "speaker": self.speaker,
                    "text": text,
                    "startedMs": round(base_ms + start_s * 1000),
                    "endedMs": round(base_ms + end_s * 1000),
                }
            )

    def _transcribe(self, audio) -> list[tuple[float, float, str]]:
        segments, _ = self.model.transcribe(
            audio,
            language="ru",
            beam_size=self.beam_size,
            condition_on_previous_text=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": MIN_SILENCE_MS},
            initial_prompt=self.initial_prompt,
        )
        out: list[tuple[float, float, str]] = []
        for seg in segments:
            text = (seg.text or "").strip()
            if not text:
                continue
            start_s = float(getattr(seg, "start", 0.0) or 0.0)
            end_s = float(getattr(seg, "end", start_s) or start_s)
            out.append((start_s, max(end_s, start_s), text))
        return out

    def stats(self):
        if not self.finals:
            return None
        return {
            "speaker": self.speaker,
            "finals": self.finals,
            "droppedMs": 0,
            "audioMs": round(self.total_ms),
            "transcribeMs": round(self.transcribe_ms),
        }


async def handle(
    ws,
    model,
    executor,
    *,
    use_silero: bool,
    max_sessions: int,
    batch_window_s: float = BATCH_WINDOW_S,
    batch_beam: int = 5,
    batch_prompt: str | None = None,
) -> None:
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

    def make_channels(mode: str) -> dict:
        if mode == "batch":
            return {
                ch: BatchTranscriber(
                    sp,
                    model,
                    executor,
                    emit,
                    loop,
                    use_silero=use_silero,
                    window_s=batch_window_s,
                    beam_size=batch_beam,
                    initial_prompt=batch_prompt,
                )
                for ch, sp in SPEAKERS.items()
            }
        return {
            ch: ChannelTranscriber(sp, model, executor, emit, loop, use_silero=use_silero)
            for ch, sp in SPEAKERS.items()
        }

    mode = "live"
    channels = make_channels(mode)

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
    bad_frames = 0
    unknown_channel_frames = 0
    try:
        async for msg in ws:
            # Любая ошибка на одном сообщении не должна ронять весь коннект:
            # он общий для обоих каналов (рекрутер + кандидат).
            try:
                if isinstance(msg, bytes):
                    if len(msg) < 2:
                        continue
                    ch = msg[0]
                    if ch not in channels:
                        unknown_channel_frames += 1
                        if unknown_channel_frames <= 3:
                            logger.warning(
                                "stt: неизвестный канал %s (%d байт) — фрейм пропущен",
                                ch,
                                len(msg),
                            )
                        continue
                    payload = msg[1:]
                    # PCM16LE: нечётная длина = битый/обрезанный фрейм,
                    # np.frombuffer(..., int16) на нём бросает ValueError.
                    if len(payload) % 2:
                        raise ValueError(
                            f"нечётная длина PCM-фрейма: {len(payload)} байт"
                        )
                    channels[ch].feed(payload)
                    # В live это no-op, в batch — транскрибация готового
                    # окна прямо в цикле чтения (backpressure).
                    await channels[ch].after_feed()
                else:
                    try:
                        data = json.loads(msg)
                    except (ValueError, TypeError):
                        continue
                    if data.get("type") == "mode":
                        want = str(data.get("mode") or "live")
                        if want not in ("live", "batch"):
                            logger.warning("stt: неизвестный режим %s — игнор", want)
                        elif want != mode:
                            if any(c.total_ms for c in channels.values()):
                                # Переключение на лету обнулило бы уже принятое
                                # аудио — клиент обязан слать `mode` до кадров.
                                logger.warning(
                                    "stt: режим %s запрошен после начала потока — игнор",
                                    want,
                                )
                            else:
                                mode = want
                                channels = make_channels(mode)
                                logger.info("stt: режим сессии — %s", mode)
                        await emit({"type": "mode", "mode": mode})
                        continue
                    if data.get("type") == "stop":
                        # Маркер шлём из finally: если flush() упадёт, мост
                        # иначе будет ждать полный таймаут вместо мгновенного
                        # закрытия.
                        try:
                            for c in channels.values():
                                await c.tick()
                                # Дожимаем открытый сегмент: тишины после
                                # последней реплики могло и не быть.
                                await c.flush()
                            stats = [s for c in channels.values() if (s := c.stats())]
                            await emit({"type": "stats", "channels": stats})
                        finally:
                            # Явный маркер конца дожима: клиент ждёт именно его,
                            # а не фиксированный sleep — на CPU flush() занимает
                            # секунды, и финалы приезжают уже после него.
                            await emit({"type": "flushed"})
            except Exception as exc:  # noqa: BLE001 — коннект не рвём
                bad_frames += 1
                if bad_frames <= 3:
                    logger.warning("stt: битый фрейм пропущен (%s)", exc)
                elif bad_frames % 100 == 0:
                    logger.warning("stt: битых фреймов уже %d", bad_frames)
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        # Клиент мог отвалиться без control `stop` — снимаем висящие задачи
        # транскрибации и дожимаем то, что осталось в буферах.
        for c in channels.values():
            c.cancel_tasks()
        for c in channels.values():
            try:
                await c.flush()
            except Exception:
                logger.exception("stt flush failed for %s", c.speaker)
        if bad_frames or unknown_channel_frames:
            logger.warning(
                "stt: пропущено фреймов — битых %d, с неизвестным каналом %d",
                bad_frames,
                unknown_channel_frames,
            )
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
    # --- офлайн-режим (распознавание загруженной записи) ---
    ap.add_argument(
        "--batch-window-s",
        type=float,
        default=float(os.getenv("STT_BATCH_WINDOW_S", str(BATCH_WINDOW_S))),
        help="Окно нарезки записи в батч-режиме, сек",
    )
    ap.add_argument(
        "--batch-beam",
        type=int,
        default=int(os.getenv("STT_BATCH_BEAM", "5")),
        help="beam_size для записи (в realtime всегда 1)",
    )
    ap.add_argument(
        "--batch-prompt",
        default=os.getenv("STT_BATCH_PROMPT", ""),
        help="initial_prompt: термины и имена, которые модель иначе перевирает",
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
            ws,
            model,
            executor,
            use_silero=use_silero,
            max_sessions=max_sessions,
            batch_window_s=args.batch_window_s,
            batch_beam=max(1, args.batch_beam),
            batch_prompt=(args.batch_prompt or "").strip() or None,
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
            "stt-service listening ws://0.0.0.0:%s (model=%s max_sessions=%d "
            "batch: window=%.0fs beam=%d prompt=%s)",
            args.port,
            "FAKE" if args.fake else args.model,
            max_sessions,
            args.batch_window_s,
            args.batch_beam,
            "on" if (args.batch_prompt or "").strip() else "off",
        )
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
