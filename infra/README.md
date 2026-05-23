# infra

Инфраструктура для локалки и dev-окружения.

- `docker-compose.dev.yml` — Postgres 16 + Redis 7 для разработки.
- `postgres-init/` — init-скрипты, выполняются при первом старте Postgres-контейнера.

## Команды

```bash
docker compose -f infra/docker-compose.dev.yml up -d
docker compose -f infra/docker-compose.dev.yml ps
docker compose -f infra/docker-compose.dev.yml down       # сохранить тома
docker compose -f infra/docker-compose.dev.yml down -v    # снести все данные
```

Production-конфиг (Yandex Cloud VM, nginx + TLS, Celery worker, Sentry, бэкапы)
переедет сюда же позже — отдельным compose-файлом, см. Этап 8 плана.
