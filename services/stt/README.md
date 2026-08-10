# stt-service (Этап 2 / 6)

Realtime STT для AI-скрининга: VAD + faster-whisper (или fake без torch).

## Dev (заглушка)

```bash
docker compose -f infra/docker-compose.dev.yml up -d stt
# → ws://localhost:8765, STT_FAKE=1
```

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
- GPU (T4) или отдельный CPU: OpenTofu `create_stt_vm=true` → `infra/terraform/stt.tf`.
- Лимит параллельных встреч: `STT_MAX_SESSIONS` (лишним — WS close 1013 + `error:busy`).
- Health: `GET http://host:8765/healthz`.

## Протокол

Клиент → сервер: `[channel:u8][pcm16le 16kHz]` или JSON `start`/`stop`.  
Сервер → клиент: `hello`, `transcript.partial` / `transcript.final`, `stats`, `error`.

Backend проксирует аудио с `/api/v1/ws/screening/{id}` сюда.
