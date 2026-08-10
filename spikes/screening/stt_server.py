"""
Spike Этап 0 — прототип stt-service для AI-скрининга.

WebSocket-сервер: принимает PCM16LE 16 кГц фреймы с тегом канала
(0 = рекрутер/микрофон, 1 = кандидат/вкладка Телемоста), сегментирует
речь через Silero VAD (идёт в составе faster-whisper, офлайн) и
распознаёт сегменты faster-whisper'ом. Отдаёт transcript.partial /
transcript.final с замером латентности.

Запуск:
    pip install faster-whisper websockets
    python stt_server.py --model small            # реальная модель
    python stt_server.py --fake                   # заглушка (проверка пайплайна)

Протокол (см. capture_prototype.html):
    клиент -> сервер: бинарный фрейм = 1 байт канала + PCM16LE 16kHz mono
                      текст: {"type":"start"} / {"type":"stop"}
    сервер -> клиент: {"type":"transcript.partial"|"transcript.final",
                       "speaker":"recruiter"|"candidate", "text":...,
                       "startedMs":..., "endedMs":..., "latencyMs":...}
                      {"type":"stats", ...} по stop
"""
import argparse
import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from faster_whisper.vad import VadOptions, get_speech_timestamps

SAMPLE_RATE = 16000
SPEAKERS = {0: "recruiter", 1: "candidate"}

# --- параметры сегментации ---
MIN_SILENCE_MS = 600       # тишина, закрывающая сегмент
PARTIAL_EVERY_S = 3.0      # как часто давать partial по открытому сегменту
MIN_SEGMENT_S = 0.4        # короче — отбрасываем (щелчки)
MAX_OPEN_SEGMENT_S = 25.0  # принудительная нарезка длинного монолога


class FakeModel:
    """Заглушка для проверки пайплайна без скачивания модели."""

    def transcribe(self, audio, **kw):
        dur = len(audio) / SAMPLE_RATE

        class Seg:
            def __init__(self, text):
                self.text = text

        return iter([Seg(f"[fake {dur:.1f}s]")]), None


def load_model(args):
    if args.fake:
        return FakeModel()
    from faster_whisper import WhisperModel
    print(f"Загружаю faster-whisper {args.model} ({args.compute_type})…")
    return WhisperModel(
        args.model, device=args.device, compute_type=args.compute_type,
        cpu_threads=args.cpu_threads,
    )


class ChannelTranscriber:
    """Стриминговая сегментация одного канала + распознавание."""

    def __init__(self, speaker, model, executor, emit, loop, partials=True):
        self.speaker = speaker
        self.model = model
        self.executor = executor
        self.emit = emit          # async callable(dict)
        self.loop = loop
        self.partials = partials
        self.buf = np.zeros(0, dtype=np.float32)
        self.buf_start_ms = 0.0   # позиция начала буфера от старта сессии, мс
        self.total_ms = 0.0
        self.last_partial_at = 0.0
        self.finals = []          # (latency_ms,)
        self.recv_wallclock_ms = None  # wallclock прихода последнего фрейма
        self._partial_task = None  # single-flight: partial не должен
                                   # конкурировать с финалами за CPU

    def feed(self, pcm_bytes):
        chunk = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buf = np.concatenate([self.buf, chunk])
        self.total_ms += len(chunk) / SAMPLE_RATE * 1000
        self.recv_wallclock_ms = time.monotonic() * 1000

    def _transcribe(self, audio):
        segments, _ = self.model.transcribe(
            audio, language="ru", beam_size=1,
            condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments).strip()

    async def tick(self):
        """Вызывается каждые ~300 мс: ищем закрытые сегменты."""
        if len(self.buf) < SAMPLE_RATE // 2:
            return
        vad = get_speech_timestamps(
            self.buf, VadOptions(min_silence_duration_ms=MIN_SILENCE_MS)
        )
        if not vad:
            # тишина — сбрасываем буфер, оставляя хвост 0.5с
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
            # последний регион ещё открыт
            open_speech = last
            closed = vad[:-1]
            open_dur = (buf_end - last["start"]) / SAMPLE_RATE
            if open_dur > MAX_OPEN_SEGMENT_S:   # принудительная нарезка
                closed = vad
                open_speech = None
        else:
            closed = vad

        for region in closed:
            await self._finalize(region)

        if closed:
            # срезаем буфер до конца последнего закрытого региона
            cut = closed[-1]["end"]
            self.buf = self.buf[cut:]
            self.buf_start_ms += cut / SAMPLE_RATE * 1000

        if open_speech is not None and self.partials:
            now = time.monotonic()
            idle = self._partial_task is None or self._partial_task.done()
            if now - self.last_partial_at > PARTIAL_EVERY_S and idle:
                self.last_partial_at = now
                start = open_speech["start"] - (closed[-1]["end"] if closed else 0)
                seg = self.buf[int(max(start, 0)):].copy()
                # не await: partial живёт фоном и не тормозит tick/финалы
                self._partial_task = asyncio.create_task(self._partial(seg))

    async def _finalize(self, region):
        seg = self.buf[region["start"]:region["end"]]
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
        # латентность = сколько прошло wallclock от момента, когда аудио
        # конца сегмента реально пришло на сервер, до готового текста.
        # (аудио шло в реальном времени, значит конец сегмента пришёл
        #  примерно при total_ms == ended_ms)
        now_ms = time.monotonic() * 1000
        audio_lag_ms = self.total_ms - ended_ms          # сколько аудио пришло после конца сегмента
        latency_ms = (now_ms - (self.recv_wallclock_ms or now_ms)) + audio_lag_ms
        transcribe_ms = now_ms - t0
        self.finals.append(latency_ms)
        await self.emit({
            "type": "transcript.final", "speaker": self.speaker, "text": text,
            "startedMs": round(started_ms), "endedMs": round(ended_ms),
            "latencyMs": round(latency_ms), "transcribeMs": round(transcribe_ms),
        })

    async def _partial(self, seg):
        if len(seg) / SAMPLE_RATE < 1.0:
            return
        text = await self.loop.run_in_executor(
            self.executor, self._transcribe, seg
        )
        if text:
            await self.emit({
                "type": "transcript.partial", "speaker": self.speaker,
                "text": text,
            })

    def stats(self):
        if not self.finals:
            return None
        arr = sorted(self.finals)
        pct = lambda p: arr[min(len(arr) - 1, int(len(arr) * p))]
        return {
            "speaker": self.speaker, "finals": len(arr),
            "latencyP50Ms": round(pct(0.50)), "latencyP95Ms": round(pct(0.95)),
            "latencyMaxMs": round(arr[-1]),
        }


async def handle(ws, model, executor):
    loop = asyncio.get_running_loop()

    async def emit(payload):
        print(f"  -> {payload['type']:>18} [{payload.get('speaker','-'):>9}]"
              f" {payload.get('latencyMs','')}"
              f" {payload.get('text','')[:80]}")
        try:
            await ws.send(json.dumps(payload, ensure_ascii=False))
        except Exception:
            pass

    channels = {
        ch: ChannelTranscriber(sp, model, executor, emit, loop)
        for ch, sp in SPEAKERS.items()
    }

    async def ticker():
        while True:
            await asyncio.sleep(0.3)
            for c in channels.values():
                await c.tick()

    task = asyncio.create_task(ticker())
    print("Клиент подключился")
    try:
        async for msg in ws:
            if isinstance(msg, bytes):
                if len(msg) < 2:
                    continue
                ch = msg[0]
                if ch in channels:
                    channels[ch].feed(msg[1:])
            else:
                data = json.loads(msg)
                if data.get("type") == "stop":
                    for c in channels.values():
                        await c.tick()
                    stats = [s for c in channels.values() if (s := c.stats())]
                    await emit({"type": "stats", "channels": stats})
    finally:
        task.cancel()
        print("Клиент отключился")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="small",
                    help="small | medium | large-v3-turbo …")
    ap.add_argument("--device", default="cpu", help="cpu | cuda")
    ap.add_argument("--compute-type", default="int8",
                    help="int8 (cpu) | int8_float16/float16 (gpu)")
    ap.add_argument("--cpu-threads", type=int, default=4)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--fake", action="store_true",
                    help="заглушка вместо модели — проверка пайплайна")
    args = ap.parse_args()

    import websockets
    model = load_model(args)
    executor = ThreadPoolExecutor(max_workers=2)

    async def _handler(ws):
        await handle(ws, model, executor)

    async with websockets.serve(_handler, "0.0.0.0", args.port, max_size=2**22):
        print(f"stt-server слушает ws://localhost:{args.port} "
              f"(model={'FAKE' if args.fake else args.model})")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
