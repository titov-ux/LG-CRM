# Runbook: типовые инциденты CRM-LG

Этот документ — короткий гайд для дежурного. Для каждой ситуации — симптомы,
быстрая проверка, действие, эскалация.

---

## 1. Бэкенд отдаёт 500 / приложение «лежит»

**Симптомы.** Пользователи жалуются на «белый экран» или 500. Sentry получил
всплеск ошибок.

**Быстрая проверка:**

```bash
docker compose -f infra/docker-compose.prod.yml ps           # все ли up?
curl -fsS https://crm.lg.ru/healthz                          # бэк живой?
docker compose -f infra/docker-compose.prod.yml logs backend --tail=200
```

**Действие:**

1. Если контейнер `backend` упал — `docker compose ... up -d backend` (рестарт).
2. Если бэк живой, но 500 — ищем стек в Sentry (`environment: prod`). Самые
   частые причины: рассинхрон миграций, недоступен Redis, превышение лимитов
   подключений к Postgres.
3. Откатить релиз: `git checkout <prev-tag>` → пересборка образа.

**Эскалация:** owner backend (см. CODEOWNERS) — если простой >15 минут.

---

## 2. Postgres недоступен

**Симптомы.** Бэк отдаёт 503 / ошибки `connection refused`. Sentry: `OperationalError`.

**Быстрая проверка:**

```bash
docker compose -f infra/docker-compose.prod.yml exec postgres pg_isready -U crm -d crm_lg
docker compose -f infra/docker-compose.prod.yml logs postgres --tail=200
df -h                                                        # не забит ли диск?
```

**Действие:**

1. Диск 100%? Расширить, удалить старые backup-файлы из `/var/lib/...`, перезапустить.
2. Контейнер упал — `docker compose ... up -d postgres`.
3. Сильное повреждение — восстановить из последнего бэкапа:

   ```bash
   bash backend/scripts/restore_db.sh s3://crm-lg-backups/daily/<latest>.dump.gz
   ```

   Затем `make migrate` и `make seed` (только seed_admin, не seed_from_mocks!).

**Эскалация:** owner infra + предупредить пользователей через Telegram-чат.

---

## 3. Recovery из бэкапа (плановое тестирование)

Раз в неделю проверяем, что бэкап разворачивается:

```bash
# на staging, не на prod
DATABASE_URL=postgresql+asyncpg://crm:crm@localhost:5432/crm_lg_restore \
    bash backend/scripts/restore_db.sh s3://crm-lg-backups/daily/<latest>.dump.gz
```

После: убедиться, что `SELECT count(*) FROM users;` возвращает разумное число
и `make migrate` сообщает «no new revisions».

---

## 4. Sentry-алерт: всплеск ошибок одной ручки

**Действие:**

1. Открыть Issue в Sentry, посмотреть стек.
2. Если регрессия — откатить релиз (см. п.1).
3. Если внешний сервис (S3 / Telegram-бот) — отметить incident в шапке,
   связаться с провайдером.
4. После фикса — «Resolve» в Sentry, чтобы не звонило повторно.

---

## 5. Ротация JWT secret

Триггеры: подозрение на утечку, плановая ротация (каждые 6 месяцев).

```bash
NEW=$(openssl rand -hex 48)
# 1. Положить новый секрет в .env.prod (JWT_SECRET).
# 2. Перезапустить только backend, postgres/redis не трогаем:
docker compose -f infra/docker-compose.prod.yml up -d backend
# 3. Все access-токены инвалидированы немедленно (новый ключ их не валидирует),
#    refresh — тоже (whitelist в Redis ещё жив, но проверка подписи упадёт);
#    пользователей разлогинит при следующем запросе.
```

Не забыть про **долго живущие интеграции** (если будут — hh.ru, calendar).

---

## 6. Полный гайд развёртывания с нуля (staging)

```bash
# 1. VM с Docker / Compose
git clone … crm-lg && cd crm-lg

# 2. Конфиг
cp .env.prod.example .env.prod
$EDITOR .env.prod  # JWT_SECRET, POSTGRES_PASSWORD, ADMIN_PASSWORD, S3-ключи, SENTRY_DSN

# 3. TLS — положить сертификаты в infra/certs/{fullchain.pem,privkey.pem}.
cp infra/nginx.example.conf infra/nginx.conf  # подставить server_name

# 4. Фронт: собрать билд
cd frontend && pnpm install && pnpm build && cd ..

# 5. Поднять стек
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d

# 6. Миграции + seed
docker compose -f infra/docker-compose.prod.yml exec backend alembic upgrade head
docker compose -f infra/docker-compose.prod.yml exec backend make seed

# 7. (опционально) Залить демо-данные из mocks
cd frontend && pnpm export-seed && cd ..
docker cp frontend/seed_data.json crm-lg-backend:/app/frontend/seed_data.json
docker compose -f infra/docker-compose.prod.yml exec backend make seed-from-mocks

# 8. Smoke-тест
curl -fsS https://staging.crm.lg.ru/healthz
curl -fsS -X POST https://staging.crm.lg.ru/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@lg.ru","password":"<пароль>"}'

# 9. Включить cron-бэкап
sudo cp scripts/cron-backup.example /etc/cron.d/crm-lg-backup
```

---

## 7. Чек-лист готовности к prod-релизу

- [ ] `.env.prod` заполнен реальными секретами, ни одного `CHANGE_ME`.
- [ ] TLS-сертификат валиден, авто-renew (certbot или Yandex Cert Manager) настроен.
- [ ] Все 9 миграций applied (`alembic current` показывает `0009_notifications`).
- [ ] Пользователи получили временные пароли и сменили их.
- [ ] Бэкап создаётся (видим первый файл в `s3://crm-lg-backups/daily/`).
- [ ] Recovery-тест прошёл на staging.
- [ ] Sentry получает события (тестовый `divide-by-zero` логируется).
- [ ] Locust-нагрузочный сценарий держит SLA (см. tests/loadtest/README.md).
- [ ] CORS_ORIGINS ограничен реальным доменом фронта.
- [ ] CI на main зелёный.

---

## Telegram-бот уведомлений

Уведомления (назначение вакансии, комментарии, смена статуса, упоминания)
дублируются в Telegram сразу после коммита транзакции.

Настройка:

1. У @BotFather: `/newbot` → получить **токен** и **@username** бота.
2. Придумать произвольный **секрет вебхука** (например, `openssl rand -hex 16`).
3. Заполнить `.env` бэка:

   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_BOT_USERNAME=my_crm_bot
   TELEGRAM_WEBHOOK_SECRET=<секрет>
   # опционально, если домен API отличается от APP_BASE_URL:
   TELEGRAM_WEBHOOK_URL=https://crm.lachevsky.ru/api/v1/integrations/telegram/webhook
   ```

4. Перезапустить бэк — на старте вызывается `setWebhook` (нужен публичный
   https; на localhost вебхук не поднять без туннеля).
5. Пользователь: Настройки → Telegram → «Подключить Telegram» → Start в боте.

Диагностика: логи `telegram: webhook registered at …` на старте; ошибки
доставки логируются (`telegram: failed to deliver…`), но не ломают запрос.
Привязка хранится в `users.telegram_chat_id`; тумблер —
`users.telegram_notifications_enabled`.

---

## 8. AI-скрининг: STT / отчёт / retention

**Симптомы.** Нет живого транскрипта; `sttReady: false` в комнате; отчёт
висит в `processing`; Sentry: `screening.stt_error` / `ai_agent_unavailable`.

**Быстрая проверка:**

```bash
# stt в compose на основной VM
docker compose -f infra/docker-compose.prod.yml ps stt
curl -fsS http://127.0.0.1:8765/healthz   # с хоста, если порт проброшен;
                                          # иначе: docker compose ... exec stt \
                                          #   python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8765/healthz').read())"
docker compose -f infra/docker-compose.prod.yml logs stt --tail=100
docker compose -f infra/docker-compose.prod.yml logs backend --tail=100 | grep screening

# Celery (пост-анализ + retention) — нужен profile celery
docker compose -f infra/docker-compose.prod.yml --profile celery ps
```

**Действие:**

1. `stt_unavailable` / контейнер down → `up -d stt`, проверить `STT_URL=ws://stt:8765`.
   Если STT вынесен на отдельную VM — она может быть просто выключена по
   расписанию рабочих часов (см. 8.4).
2. `busy` (1013) → очередь полна: поднять `STT_MAX_SESSIONS` или вынести STT
   на GPU-VM (`create_stt_vm` в tofu, см. `infra/terraform/stt.tf`).
   Сколько сессий занято прямо сейчас — видно в `/healthz` stt-service
   (`activeSessions`/`maxSessions`) и в `screening_active_sessions` на бэкенде.
   Осторожно с потолком: `STT_MAX_SESSIONS` ограничен CPU/RAM (CPU ≈ 2–3,
   T4 ≈ 5–8) и лимитами контейнера `STT_MEM_LIMIT`/`STT_CPUS`.
3. p95 STT > 5 с в логах `screening.stt_final` → снизить модель / включить GPU /
   уменьшить параллелизм. Снимок счётчиков: `GET /metrics` (Prometheus) или
   `GET /api/v1/analytics/screening` (admin JSON); готовые правила алертов —
   `infra/alerts/screening.rules.yml` (см. 8.3).
4. Отчёт не появляется → worker жив? `SCREENING_ANALYSIS_EAGER=false` на prod
   требует celery-worker; смотреть задачу `screening.analyze_session` (см. 8.2).
5. Аудио «пропало» через N дней — норма: `SCREENING_AUDIO_RETENTION_DAYS`
   (beat `screening.purge_expired_audio` в 03:15 UTC). Транскрипт/отчёт остаются.
6. Транскрипта нет, но `sttReady: true` и ошибок нет → почти всегда это захват
   звука на стороне рекрутера, а не сервер: в диалоге «Поделиться» не выбрана
   вкладка Телемоста или не включена галка «Поделиться звуком вкладки».
   Проверяется по индикаторам уровня в комнате (молчит канал кандидата) и по
   предупреждению «вкладка молчит» в UI. Косвенный серверный признак —
   `screening_segments_dropped_total{reason="hallucination"}` растёт, а
   финальных сегментов нет: Whisper выдаёт мусор на тишине, фильтр его режет.

**Один uvicorn-воркер — это осознанно.** Backend в проде запускается с
`--workers 1` (см. комментарий в `infra/docker-compose.prod.yml`): реестры
активных WS-сокетов и припаркованных STT-мостов живут в памяти процесса, при
2+ воркерах ломаются вытеснение соединения и переиспользование моста.
Практические следствия для дежурного:
* рестарт backend рвёт ВСЕ live-встречи разом (клиенты переподключатся сами,
  но контекст STT-моста теряется) — не перезапускать в рабочие часы без нужды;
* `GET /metrics` показывает весь backend целиком (при нескольких воркерах
  показания были бы от случайного воркера), но счётчики in-process и
  обнуляются при рестарте — в Prometheus смотреть через `increase()`/`rate()`.

**Права.** Матрица: `screening:run` (вести встречу), `screening:view_report`
(транскрипт/отчёт/аудио). Без права API отдаёт 403.

**Эскалация:** owner screening / infra, если простой >30 минут в рабочее время.

### 8.1. YandexGPT недоступен / не задан ключ

**Симптомы.** Кнопка «Сгенерировать вопросы» отдаёт 503 `ai_unavailable`
(и 502 `ai_bad_request`, если модель вернула мусор); во время встречи агент
молчит — новых follow-up вопросов в чек-листе не появляется; после finish
отчёт всё равно приходит, но это fallback-текст без выводов модели
(в `screening_reports` поле model = `fallback`). В логах / Sentry:
`screening.ai_agent_unavailable`, `screening.ai_report_fallback`,
`Yandex AI Studio is not configured (YANDEX_API_KEY / YANDEX_FOLDER_ID)`.

**Быстрая проверка:**

```bash
# 1. Ключ и folder вообще доехали до контейнера?
docker compose -f infra/docker-compose.prod.yml exec backend \
  python -c "from app.core.config import get_settings as g; s=g(); \
print('key:', bool(s.yandex_api_key), 'folder:', s.yandex_folder_id or '—', \
'model:', s.yandex_ai_model, 'ai_enabled:', s.screening_ai_enabled)"

# 2. Что именно отвечает Yandex (401/403 = ключ/роль, 429 = квота, 5xx = их сторона)
docker compose -f infra/docker-compose.prod.yml logs backend --tail=300 \
  | grep -Ei "yandex|ai_unavailable|ai_agent_|ai_report_"
```

**Действие:**

1. Пусто в `key`/`folder` → в `.env.prod` не заполнены `YANDEX_API_KEY` /
   `YANDEX_FOLDER_ID` (шаблон — в `.env.prod.example`). Дописать и
   перезапустить backend + celery-worker (`up -d backend celery-worker`),
   переменные читаются только на старте процесса.
2. 401/403 от Yandex → ключ отозван или у сервисного аккаунта нет роли
   `ai.languageModels.user` в нужном каталоге; перевыпустить в AI Studio →
   Settings → API keys.
3. 429 / таймауты → упёрлись в квоту AI Studio: поднять квоту в консоли YC
   либо снизить нагрузку агента (`SCREENING_AI_MIN_INTERVAL_SEC` вверх,
   `SCREENING_AI_MAX_CALLS_PER_SESSION` вниз).
4. Модель `yandexgpt/rc` отвечает нестабильно (`ai_bad_request`) → временно
   переключить `YANDEX_AI_MODEL=yandexgpt/latest`.
5. Встреча уже идёт, а чинить некогда → работать по ручному чек-листу:
   вопросы добавляются руками, транскрипт и запись от YandexGPT не зависят.
   Совсем выключить вызовы LLM во время встречи — `SCREENING_AI_ENABLED=false`.

**Важно.** Отчёт-fallback перезаписывается нормальным только повторным
прогоном пост-анализа — см. 8.2.

### 8.2. Сессия висит в `processing` / ручной перезапуск пост-анализа

После finish сессия переходит в `processing`, и задача Celery
`screening.analyze_session` (`backend/app/modules/screening/tasks.py`,
внутри — `service.run_post_analysis`) собирает отчёт и переводит статус в
`done` (или `error`). Висит `processing` = задачу никто не выполнил.

**Быстрая проверка:**

```bash
# 1. Какие сессии застряли
docker compose -f infra/docker-compose.prod.yml exec postgres \
  psql -U crm -d crm_lg -c "select id, status, ended_at from screening_sessions \
where status in ('processing','error') order by ended_at desc limit 20;"

# 2. Жив ли worker и не копится ли очередь (--profile celery обязателен!)
docker compose -f infra/docker-compose.prod.yml --profile celery ps
docker compose -f infra/docker-compose.prod.yml --profile celery \
  logs celery-worker --tail=200 | grep -i screening
docker compose -f infra/docker-compose.prod.yml exec redis redis-cli llen celery
```

**Действие:**

1. Нет контейнеров celery-worker/celery-beat → стек подняли без
   `--profile celery`. Поднять: `... --profile celery up -d` (см. шапку
   `infra/docker-compose.prod.yml`); накопившиеся сессии дожать шагом 3.
2. Worker жив, очередь пустая, задача потерялась (рестарт до ack) →
   поставить заново:

   ```bash
   docker compose -f infra/docker-compose.prod.yml exec backend python -c "
   from app.modules.screening.tasks import analyze_screening_session as t
   print(t.delay('<session_uuid>').id)"
   ```

3. Worker поднять нельзя (или нужен результат прямо сейчас) → выполнить
   анализ синхронно в контейнере backend:

   ```bash
   docker compose -f infra/docker-compose.prod.yml exec backend python -c "
   import asyncio, uuid
   from app.modules.screening.service import run_post_analysis
   asyncio.run(run_post_analysis(uuid.UUID('<session_uuid>')))"
   ```

   `run_post_analysis` идемпотентен: если отчёт уже готов и статус `done` —
   ничего не делает; статусы `processing` / `error` / `done`-без-отчёта
   пересчитываются, поэтому им же перегенерируется и fallback-отчёт из 8.1.
4. Сессия ушла в `error` → смотреть traceback в логах backend/worker по
   `screening.analysis: failed for <id>`; после устранения причины —
   шаг 2 или 3.
5. Массово застряло много сессий (был долгий простой worker'а) → тот же
   вызов в цикле по списку id из шага 1; каждый прогон — один вызов LLM,
   поэтому учитывайте квоту AI Studio.

**Автоматика.** `SCREENING_PROCESSING_TIMEOUT_MIN` (минуты, дефолт 45,
0 = выключено) — через столько уборщик сам переставит потерянную задачу
пост-анализа, а если и это не помогло (втрое дольше) — переведёт сессию в
`error`, чтобы карточка не крутила «обработку» вечно. Делает это периодическая
beat-задача уборщика, то есть **без `--profile celery` автоматика не работает**
и всё лечится только руками по шагам выше.

### 8.2.1. Транскрипт загруженной записи пуст или рваный

Распознавание записи (кнопка «Распознать запись» / `attach`) идёт по цепочке
`celery-worker → S3 → ffmpeg → stt-service (режим batch)`. Все сбои внутри
`run_offline_transcription` подавляются и наружу выглядят одинаково: пустой
транскрипт и отчёт `model=fallback`. Причина — всегда в логах воркера:

```bash
docker logs --since 2h crm-lg-celery-worker 2>&1 | grep 'screening\.offline:'
```

| Строка в логе | Что случилось |
|---|---|
| задачи нет вовсе | стек подняли без `--profile celery` — распознавать некому |
| `Connect call failed ('127.0.0.1', 8765)` | `STT_URL` не доехал в контейнер воркера. Переменные из `env_file` подхватываются только при СОЗДАНИИ контейнера: `up -d --force-recreate celery-worker` |
| `STT failed for … (ffmpeg …)` | битая или пустая запись |
| `wrote 0 segment(s)` | stt-service ответил, но текста нет — смотреть логи `stt` |

Отдельно: **пропуски и перепутанный порядок реплик** — признак того, что
запись распозналась в live-режиме (старый образ stt-service не понимает
`{"type":"mode","mode":"batch"}` и режет буфер по `MAX_BUFFER_S`). Лечится
выкаткой backend и stt-service **вместе**; в логах воркера это видно как
предупреждение «stt-service не подтвердил batch-режим».

**Роли в транскрипте.** Записи, сделанные до перехода на стерео-захват, — моно,
разделить в них рекрутёра и кандидата нечем, поэтому все реплики помечаются
кандидатом. У новых записей канал 0 — микрофон, канал 1 — вкладка, роли
проставляются из дорожек (`offline_stt.decode_tracks`).

### 8.3. Алерты Prometheus по скринингу

Правила лежат в `infra/alerts/screening.rules.yml` (создаются вместе с
инфраструктурой мониторинга; в самом compose Prometheus не поднимается).

**Как подключить.** Смонтировать файл в Prometheus и сослаться на него в
`prometheus.yml`:

```yaml
rule_files:
  - /etc/prometheus/rules/screening.rules.yml
scrape_configs:
  - job_name: crm-lg-backend      # имя job'а используется в самих правилах
    metrics_path: /metrics
    scheme: https
    static_configs:
      - targets: ["crm.lachevsky.ru"]
```

Проверка перед reload: `promtool check rules infra/alerts/screening.rules.yml`.
Источник метрик — `GET /metrics` (in-process счётчики,
`backend/app/modules/screening/metrics.py`); при рестарте backend они
обнуляются, поэтому в правилах везде `increase()`.

**Что делать по каждому алерту:**

| Алерт | Смысл | Первое действие |
|---|---|---|
| `ScreeningSttLatencyP95High` | p95 распознавания > 5 с | п.3 в §8: легче модель / GPU / меньше параллельных встреч |
| `ScreeningSttFramesDropped` | кадры PCM выбрасываются (backpressure) — дыры в транскрипте | то же, что и при высокой латентности; аудио в S3 при этом целое |
| `ScreeningSttErrorsBurst` | всплеск ошибок моста (down / busy / обрыв) | п.1–2 в §8; причина — в логах `screening.stt_error reason=…` |
| `ScreeningSttNoTranscript` | идут live-сессии, а финальных сегментов нет | stt-service недоступен: `ps stt`, `/healthz:8765`, `STT_URL`, VM включена? (8.4) |
| `ScreeningMetricsScrapeDown` | Prometheus не скрапит backend | §1 руководства: жив ли backend вообще |
| `ScreeningAiAgentUnavailable` / `ScreeningAiAgentBadRequest` | YandexGPT недоступен / отвечает мусором | §8.1 |
| `ScreeningReportFallbackRate` | отчёты собираются без выводов модели | §8.1, затем перегенерация по §8.2 |
| `ScreeningReportErrors` | пост-анализ падает с исключением | §8.2, шаги 4–5 |

Алерта «сессии залипли в processing» нет: подходящей метрики не существует
(в `/metrics` нет счётчика сессий по статусам). Пока за это отвечают
`SCREENING_PROCESSING_TIMEOUT_MIN` и SQL-проверка из §8.2 — подробности
и заготовка правила записаны комментарием в конце файла правил.

### 8.4. GPU-VM для STT: включение, выключение, расписание

Отдельная VM под stt-service создаётся OpenTofu (`infra/terraform/stt.tf`,
`create_stt_vm = true`); имя — `stt_vm_name` или `<vm_name>-stt`. Backend ходит
на неё по внутреннему адресу: `STT_URL=ws://<stt_private_ip>:8765`.

Управление питанием — `infra/scripts/stt-vm-schedule.sh` (обёртка над
`yc compute instance start|stop`; инстанс задаётся `STT_VM_ID` или
`STT_VM_NAME`):

```bash
export STT_VM_NAME=crm-lg-prod-stt
bash infra/scripts/stt-vm-schedule.sh status   # RUNNING/STOPPED + оба IP
bash infra/scripts/stt-vm-schedule.sh start    # перед встречей
bash infra/scripts/stt-vm-schedule.sh stop     # после рабочего дня
```

Расписание рабочих часов (09:00–20:00 МСК = 06:00–17:00 UTC, пн–пт) ставится
в cron — готовый блок для `/etc/cron.d/crm-lg-stt-vm` есть в шапке скрипта.
Помнить:

- пока VM выключена, живого транскрипта нет: комната работает, запись идёт в
  S3, `sttReady:false`. Внеурочную встречу — поднять руками (`start`) заранее,
  модель прогревается не мгновенно, первые минуты латентность выше;
- `stop` не проверяет, идёт ли встреча: перед плановой остановкой посмотреть
  `screening_active_sessions` / `/healthz` stt-service;
- после старта внутренний IP сохраняется, а публичный (NAT) может смениться —
  если `STT_URL` вдруг указывает на публичный адрес, проверить его командой
  `status` и поправить `.env.prod`;
- офлайн-путь не страдает: запись, доехавшая в S3, расшифровывается задачей
  `screening.offline_transcribe` позже, когда VM снова включена.

---

## Полезные ссылки

- Архитектура: `Архитектура_CRM_ЛГ_Интеграция.docx`
- План перехода: `План_перехода_на_API.docx`
- OpenAPI: `docs/openapi.yaml` (Swagger UI на `/docs`)
- WS-протокол комнаты скрининга: `docs/ws-screening.md` (в OpenAPI его нет)
- Алерты по скринингу: `infra/alerts/screening.rules.yml`
- Backend README: `backend/README.md`
- Infra README: `infra/README.md`

---

## Быстрый деплой обновлений на VM

Стандартный путь для выката новой версии:

```bash
bash scripts/deploy-vm.sh --branch main
```

Что делает скрипт:

1. Забирает обновления из git (`fetch` + `pull --ff-only`).
2. Собирает фронт (`pnpm install --frozen-lockfile && pnpm build`).
3. Пересобирает и поднимает сервисы (`docker compose ... up -d --build`).
4. Прогоняет миграции (`alembic upgrade head`).
5. Делает health-check `https://localhost/healthz` (`-k`, чтобы не упасть на self-signed/чужом CN).

Полезные опции:

- `--skip-frontend` — если фронт не менялся.
- `--skip-migrate` — если точно нет миграций.
