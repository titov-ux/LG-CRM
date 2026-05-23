# Sentry: настройка и работа с инцидентами

## 1. Заведение проекта

1. Sentry Cloud → **+ Create Project**.
   - Platform: для бэка — **FastAPI**, для фронта — **React** (создаём **два** отдельных проекта; они будут связаны через `release:` метку).
   - Alert frequency: «Default». Алерты докручиваем сами (см. ниже).
2. Скопируйте DSN из проекта в `.env.prod`:
   ```
   SENTRY_DSN=https://...@sentry.io/...   # для backend
   ```
3. Для фронта — в `frontend/.env.production`:
   ```
   VITE_SENTRY_DSN=https://...@sentry.io/...
   ```
4. Перезапустите бэк (`docker compose ... up -d backend`) и пересоберите фронт (`pnpm build`).

## 2. Releases

Чтобы Sentry группировал ошибки по версиям и показывал «новые с этого релиза»:

```bash
# В CI после build:
VERSION=$(git rev-parse --short HEAD)
sentry-cli releases new -p crm-lg-backend "$VERSION"
sentry-cli releases set-commits "$VERSION" --auto
sentry-cli releases finalize "$VERSION"
```

Тегните env-переменной `SENTRY_RELEASE=$VERSION` бэк и `VITE_APP_VERSION=$VERSION` фронт.

## 3. Алерты — какие включить

В Sentry → **Alerts → Create Alert Rule** для каждого проекта.

### P1 — критичные (страница, sms / звонок)

Эти инциденты будят дежурного. Один из триггеров должен сработать на «лежит прод», и не должен на «один user-юзер словил баг».

| Имя | Условие | Channel |
|---|---|---|
| 5xx storm (BE) | `event.type:error AND http.status_code:>=500` — `>20 событий за 5 минут` | Telegram + SMS |
| App down | uptime check на `https://crm.lg.ru/healthz` — 2 failures подряд | Telegram + SMS |
| Auth flooding | `transaction:/api/v1/auth/login AND http.status_code:429` — `>100/5мин` | Telegram |

### P2 — обычные ошибки (email / Telegram)

| Имя | Условие | Channel |
|---|---|---|
| New issue | Любая новая issue (`is:unresolved is:new`) | Telegram |
| Issue regressed | `is:regressed` | Telegram |
| Performance | p95 latency `/api/v1/*` > 1500 ms за 10 минут | Telegram |

### P3 — информационные (только в Sentry)

| Имя | Условие | Channel |
|---|---|---|
| FE error | Проект фронта, любая новая issue, без алертов — только в инбоксе |

## 4. Owners (CODEOWNERS в Sentry)

В Settings → Ownership Rules назначить:
```
path:backend/app/modules/auth/*      @ops
path:backend/app/modules/matching/*  @backend-team
path:backend/app/modules/files/*     @backend-team
path:frontend/src/features/*         @frontend-team
```

Это автоматически назначает «owner» issue в Sentry, и алерт уйдёт в правильный канал.

## 5. Разбор инцидента

Шаги при срабатывании P1-алерта:

1. Создать ChatOps-канал инцидента (или ветку в общем).
2. Найти первое появление в Sentry — оттуда стек.
3. Запустить «короткий чек» — `docker compose ... logs backend --tail=200`, `pg_isready`, дашборд CPU/Mem на Yandex Cloud.
4. **Stop the bleeding**: либо откат релиза, либо рестарт контейнера, либо ручной обход (выключить эндпоинт через nginx).
5. После остановки — занести в `docs/incidents/{дата-короткое-имя}.md` по шаблону.

## 6. Шумоподавление

Не все события стоит видеть:

- Игнорируйте `4xx`-ошибки от валидации форм (это норма).
- Сделайте filter на `event.environment:dev` — только prod-инциденты бьют по алертам.
- Sample rate для performance — 5%–10% достаточно (`SENTRY_TRACES_SAMPLE_RATE=0.05`).

## 7. Полезные дашборды в Sentry

- **Releases** — какой релиз сколько ошибок принёс.
- **Issues by URL** — какие эндпоинты дают больше всего ошибок.
- **Performance / Transactions** — топ-N медленных эндпоинтов.
