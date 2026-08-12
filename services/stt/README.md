# stt-service (Этап 2 / 6)

Realtime STT для AI-скрининга: VAD + faster-whisper (или fake без torch).

## Dev (заглушка)

```bash
STT_FAKE=1 docker compose -f infra/docker-compose.dev.yml up -d stt
# → ws://localhost:8765
```

Заглушка включается ТОЛЬКО переменной `STT_FAKE=1`: в
`infra/docker-compose.dev.yml` стоит `STT_FAKE: ${STT_FAKE:-0}`, то есть по
умолчанию сервис пытается поднять настоящую модель. С `STT_FAKE=1` в
транскрипт (и в БД) пишутся строки вида «[fake N.Ns]» — это ожидаемо.

Без Docker:

```bash
cd services/stt
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
STT_FAKE=1 python server.py
```

В `backend/.env`: `STT_URL=ws://localhost:8765`.

## Реальная модель (CPU)

```bash
docker compose -f infra/docker-compose.dev.yml build \
  --build-arg STT_FULL=1 stt
# environment: STT_FAKE=0 STT_MODEL=small
```

или локально: `pip install -r requirements-full.txt && STT_FAKE=0 python server.py`.

## Prod / GPU (Этап 6)

- CPU на основной VM: сервис `stt` в `infra/docker-compose.prod.yml`.
  Он ограничен `STT_MEM_LIMIT`/`STT_CPUS` — на 2-vCPU VM больше 1 CPU отдавать
  нельзя, иначе whisper душит backend и postgres.
- GPU (T4) или отдельный CPU: OpenTofu `create_stt_vm=true` → `infra/terraform/stt.tf`.
  Включение/выключение такой VM по расписанию рабочих часов —
  `infra/scripts/stt-vm-schedule.sh` (cron-блок в шапке скрипта, процедура —
  `docs/runbook.md` §8.4).
- Лимит параллельных встреч: `STT_MAX_SESSIONS` (лишним — WS close 1013 + `error:busy`).
- Health: `GET http://host:8765/healthz` → `{"ok":true,"activeSessions":N,"maxSessions":M}`.

## Протокол

Клиент → сервер: `[channel:u8][pcm16le 16kHz]` или JSON `start`/`stop`/`mode`.  
Сервер → клиент: `hello`, `transcript.partial` / `transcript.final`, `stats`
(итоги по каналам: `finals`, `latencyP50Ms`/`P95`/`Max`, `droppedMs`),
`flushed` (дожим после `stop` закончен), `mode` (подтверждение режима) и `error`.

### Режимы: `live` и `batch`

По умолчанию сессия работает в режиме `live` — живая встреча: короткие
сегменты, `transcript.partial`, `beam_size=1` и потолок буфера `MAX_BUFFER_S`
(при перегрузке старое аудио выбрасывается — лучше потерять фразу, чем
копить задержку).

`{"type":"mode","mode":"batch"}`, отправленный **до первого аудиокадра**,
переключает сессию в офлайн-режим для распознавания уже готовой записи:

- буфер не режется, дропов нет: приём кадра и транскрибация идут в одном
  цикле, и отправителя тормозит TCP (backpressure). Именно из-за дропов
  realtime-режим на записи давал дыры в полразговора;
- запись режется окнами `STT_BATCH_WINDOW_S` по границам тишины (VAD), каждое
  окно уходит в Whisper целиком с `vad_filter` и `condition_on_previous_text`;
- тайминги берутся у самого Whisper (`segment.start/.end` + смещение окна) —
  порядок монотонный, дублей на стыках нет;
- `beam_size` — `STT_BATCH_BEAM` (по умолчанию 5), `initial_prompt` —
  `STT_BATCH_PROMPT` (имена и термины, которые модель иначе перевирает).

Сервер отвечает `{"type":"mode","mode":"batch"}`. Старый образ на это
сообщение не ответит — вызывающая сторона (`offline_stt.py`) подождёт ответ
несколько секунд и продолжит в live-режиме, поэтому **backend и stt-service
выкатываются вместе**.

Backend проксирует аудио с `/api/v1/ws/screening/{id}` сюда; протокол внешней
ручки (со стороны браузера) описан в `docs/ws-screening.md`. Размер фрейма
ограничен 4 МБ с обеих сторон: `websockets max_size=2**22` здесь и в
`backend/app/modules/screening/stt_bridge.py`, плюс `--ws-max-size 4194304`
у uvicorn.

## Диагностика

Полные сценарии — `docs/runbook.md` §8. Коротко, по симптомам:

- **«Нет транскрипта», в комнате `sttReady: false`.** Сервис не поднят или
  недоступен по `STT_URL`: `docker compose ... ps stt`, `/healthz`, логи
  `stt`. На бэкенде это видно как `screening.stt_error reason=stt_unavailable`
  (и `stt_disconnected` / `stt_closed`, если мост умер уже в процессе).
  Backend при этом соединение с рекрутером НЕ рвёт: супервизор переподключает
  мост каждые 5 с и шлёт `session.state {sttReady:true}` после починки.
- **`sttReady: true`, но текста нет.** Смотреть не сюда, а на захват звука:
  в диалоге «Поделиться» не выбрана вкладка Телемоста или не включена галка
  «Поделиться звуком вкладки» — тогда канал кандидата (`channel=1`) молчит.
- **«STT перегружен».** В логе `stt busy: active=N max=M — rejecting`, клиенту
  уходит `{"type":"error","error":"busy"}` и close 1013; backend считает это
  обычной STT-ошибкой (метрика `screening_stt_errors_total`, reason только в
  логах). Лечится ростом `STT_MAX_SESSIONS` (CPU ≈ 2–3, T4 ≈ 5–8, упирается в
  лимиты контейнера) или выносом на GPU-VM.
- **Медленно (p95 > 5 с).** Проверить, что не включена тяжёлая модель на CPU;
  цифры — `GET /metrics` бэкенда (`screening_stt_latency_ms{quantile="0.95"}`)
  и `stats` в конце сессии от самого сервиса. Алерты —
  `infra/alerts/screening.rules.yml`.
- **Дыры в транскрипте при живом STT.** Два места, где выбрасывается аудио:
  backend не успевает отдавать кадры в мост
  (`screening_stt_frames_dropped_total`), либо переполнен буфер канала уже
  здесь — в логе `stt: буфер <speaker> переполнен (>30 с) — отброшено … мс`,
  итог за сессию есть в `stats.droppedMs`. И то, и другое — перегруз;
  аудиозапись в S3 при этом целая, можно расшифровать офлайн.

Одно WS-соединение = одна встреча (два канала внутри). Backend в проде
запускается с `--workers 1`, поэтому реконнект рекрутера переиспользует уже
открытую здесь сессию в течение `SCREENING_WS_HOLD_SEC` и не занимает второй
слот из `STT_MAX_SESSIONS`.
