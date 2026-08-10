"""
Spike Этап 0 — бенчмарк латентности без браузера.

Кормит WAV-файл (16 кГц mono PCM16) в тот же пайплайн, что stt_server,
в реальном времени (или ускоренно с --speed), и печатает p50/p95
латентности финальных сегментов.

    python bench_realtime.py interview_ru.wav --model small
    python bench_realtime.py interview_ru.wav --model medium --cpu-threads 8
    python bench_realtime.py interview_ru.wav --fake --speed 8   # проверка пайплайна

Критерий Этапа 0: p95 ≤ 3000 мс на целевом железе.
Также печатает RTF (real-time factor) чистого распознавания.
"""
import argparse
import asyncio
import time
import wave
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import stt_server
from stt_server import SAMPLE_RATE, ChannelTranscriber, load_model


async def run(args):
    model = load_model(args)
    executor = ThreadPoolExecutor(max_workers=2)
    loop = asyncio.get_running_loop()

    w = wave.open(args.wav, "rb")
    assert w.getframerate() == SAMPLE_RATE and w.getnchannels() == 1, \
        "нужен WAV 16kHz mono (ffmpeg -i in -ar 16000 -ac 1 out.wav)"
    pcm = w.readframes(w.getnframes())
    audio_s = len(pcm) / 2 / SAMPLE_RATE
    print(f"Аудио: {audio_s:.1f}s, скорость подачи x{args.speed}")

    # чистый RTF: одно распознавание всего файла
    if not args.fake:
        arr = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        t0 = time.monotonic()
        segments, _ = model.transcribe(arr, language="ru", beam_size=1)
        n = sum(1 for _ in segments)
        rtf = (time.monotonic() - t0) / audio_s
        print(f"RTF (офлайн, весь файл, {n} сегм.): {rtf:.2f} "
              f"({'✅ быстрее реального времени' if rtf < 1 else '❌ МЕДЛЕННЕЕ реального времени'})")

    async def emit(p):
        t = p.get("type", "")
        if t == "transcript.final":
            print(f"  final +{p['latencyMs']:>5}ms (whisper {p['transcribeMs']}ms) "
                  f"[{p['startedMs']/1000:6.1f}-{p['endedMs']/1000:6.1f}] {p['text'][:70]}")
        elif t == "transcript.partial":
            print(f"  partial              … {p['text'][:70]}")

    tr = ChannelTranscriber("candidate", model, executor, emit, loop,
                            partials=not args.no_partials)

    # тикер — фоном, как в stt_server: подача аудио от него не зависит
    async def ticker():
        while True:
            await asyncio.sleep(0.3)
            await tr.tick()
    tick_task = asyncio.create_task(ticker())

    # подача по абсолютным часам — если CPU перегружен, увидим отставание
    chunk_ms = 100
    chunk_bytes = SAMPLE_RATE * 2 * chunk_ms // 1000
    start_t = time.monotonic()
    worst_drift = 0.0
    for i, off in enumerate(range(0, len(pcm), chunk_bytes)):
        target = start_t + (i * chunk_ms / 1000) / args.speed
        delay = target - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        else:
            worst_drift = max(worst_drift, -delay)
        tr.feed(pcm[off:off + chunk_bytes])
    if worst_drift > 0.5:
        print(f"⚠️ подача отставала от реального времени до {worst_drift:.1f}с — "
              f"CPU не вывозит, цифры латентности завышены")
    # добиваем тишиной, чтобы VAD закрыл последний сегмент, и ждём хвост
    tr.feed(b"\x00" * (SAMPLE_RATE * 2 * 2))
    deadline = time.monotonic() + 30
    prev, stable = -1, 0
    while time.monotonic() < deadline and stable < 4:
        await asyncio.sleep(1.0)
        stable = stable + 1 if len(tr.finals) == prev else 0
        prev = len(tr.finals)
    tick_task.cancel()

    s = tr.stats()
    print("\n===== ИТОГ =====")
    if s:
        print(f"финальных сегментов: {s['finals']}")
        print(f"латентность p50: {s['latencyP50Ms']} мс, "
              f"p95: {s['latencyP95Ms']} мс, max: {s['latencyMaxMs']} мс")
        if args.speed == 1 and not args.fake:
            verdict = "✅ ПРОХОДИТ" if s["latencyP95Ms"] <= 3000 else "❌ НЕ проходит"
            print(f"Критерий p95 ≤ 3000 мс: {verdict}")
        else:
            print("(латентность показательна только при --speed 1 и реальной модели)")
    else:
        print("сегментов не найдено")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--model", default="small")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute-type", dest="compute_type", default="int8")
    ap.add_argument("--cpu-threads", dest="cpu_threads", type=int, default=4)
    ap.add_argument("--fake", action="store_true")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--no-partials", dest="no_partials", action="store_true",
                    help="чистый замер финалов, без partial-гипотез")
    args = ap.parse_args()
    asyncio.run(run(args))
