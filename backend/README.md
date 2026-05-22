# CRM ЛГ Интеграция — backend

Модульный монолит на **FastAPI 0.115 + SQLAlchemy 2.0 (async) + Postgres 16 + Redis 7 + Celery 5**.
Контракт API живёт в `../docs/openapi.yaml` — он же главный артефакт согласования с фронтом.

## Быстрый старт

```bash
cp .env.example .env
# поднять postgres + redis
docker compose -f ../infra/docker-compose.dev.yml up -d

# установить зависимости и запустить
make install
make migrate     # alembic upgrade head (пока миграций нет)
make dev         # uvicorn --reload на :8000
```

После старта:
- API: <http://localhost:8000/api/v1>
- Swagger UI: <http://localhost:8000/docs>
- OpenAPI JSON: <http://localhost:8000/api/v1/openapi.json>
- Healthcheck: <http://localhost:8000/healthz>

## Структура

```
backend/
├── app/
│   ├── api/v1/             — роутеры по доменам (auth, clients, vacancies, …)
│   ├── core/               — config, security, errors, pagination
│   ├── db/                 — SQLAlchemy base + session
│   ├── modules/            — модели/схемы/сервисы каждого домена
│   ├── integrations/       — S3, Telegram, Unisender, hh.ru
│   └── main.py             — entrypoint FastAPI
├── alembic/                — миграции БД
├── tests/
└── scripts/                — seed, импорт mocks/db, утилиты
```

## Этапы (см. План_перехода_на_API.docx)

- **Этап 0** ✅ — скелет, контракт OpenAPI, CI
- Этап 1 — Auth (JWT, /auth/me, rate limit)
- Этап 2 — Users + Permissions
- Этап 3 — Clients + Contacts
- Этап 4 — Vacancies + Kanban
- Этап 5 — Candidates + Matching + Comments
- Этап 6 — Files (S3 presigned URL)
- Этап 7 — Notifications + Analytics + Audit UI

## Команды

| Команда | Что делает |
|---|---|
| `make dev` | uvicorn с автоперезагрузкой |
| `make lint` | ruff check |
| `make typecheck` | mypy |
| `make test` | pytest |
| `make revision m="msg"` | новая миграция alembic |
| `make migrate` | применить миграции |
