"""Конфигурация приложения (Pydantic Settings → .env)."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Окружение ───────────────────────────────────────────
    env: Literal["dev", "staging", "prod"] = "dev"
    debug: bool = True
    api_v1_prefix: str = "/api/v1"

    # ── База данных / кэш ───────────────────────────────────
    database_url: PostgresDsn = Field(
        default="postgresql+asyncpg://crm:crm@localhost:5432/crm_lg",
    )
    redis_url: RedisDsn = Field(default="redis://localhost:6379/0")

    # ── JWT ─────────────────────────────────────────────────
    jwt_secret: str = Field(default="change-me-in-prod")
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14

    # ── CORS ────────────────────────────────────────────────
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # ── Seed ────────────────────────────────────────────────
    admin_email: str = "admin@lg.ru"
    admin_password: str = "change-me"

    # ── Файлы / S3 ──────────────────────────────────────────
    s3_endpoint: str = "https://storage.yandexcloud.net"
    s3_region: str = "ru-central1"
    s3_bucket: str = "crm-lg-files"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    file_max_bytes: int = 25 * 1024 * 1024  # 25 МБ (ТЗ §5.9)

    # ── Sentry ──────────────────────────────────────────────
    sentry_dsn: str = ""
    sentry_environment: str = "dev"
    sentry_traces_sample_rate: float = 0.0

    # ── Frontend / приглашения ──────────────────────────────
    # Базовый URL фронта — используется в письме-приглашении (`{app_base_url}/invite/{token}`).
    # dev     = http://localhost:5173
    # staging = https://staging.lachevsky.ru
    # prod    = https://crm.lachevsky.ru  (НЕ голый lachevsky.ru — прод живёт на поддомене)
    app_base_url: str = "http://localhost:5173"
    # Срок жизни invite-токена в днях. 7 дней — компромисс между UX и безопасностью.
    invite_ttl_days: int = 7

    # ── SMTP (Yandex 360 / любой SMTP) ──────────────────────
    # Прод: smtp.yandex.ru:465 (SSL) + ящик noreply@lachevsky.group + «пароль приложения»
    # из Яндекс ID. Без `smtp_host`/`smtp_user`/`smtp_password` отправка отключена,
    # вместо реального письма логируем превью в stdout — удобно для dev.
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_use_ssl: bool = True  # порт 465 = implicit SSL; для 587 ставить False (STARTTLS)
    smtp_user: str = ""
    smtp_password: str = ""
    # Адрес «от кого». Если пуст — используем smtp_user.
    smtp_from: str = ""
    smtp_from_name: str = "ЛГ Интеграция"
    smtp_timeout_seconds: float = 15.0

    # ── YandexGPT (AI-распознавание брифа вакансии) ─────────
    # Yandex Cloud AI Studio — OpenAI-совместимый API.
    # Без ключа эндпоинт POST /vacancies/parse-text вернёт 503 ai_unavailable.
    yandex_api_key: str = ""
    yandex_folder_id: str = ""
    yandex_ai_base_url: str = "https://ai.api.cloud.yandex.net/v1"
    # `yandexgpt/rc` — последний release-candidate (YandexGPT 5 Pro, поддерживает
    # response_format=json_schema). Для стабильной — `yandexgpt/latest`.
    yandex_ai_model: str = "yandexgpt/rc"
    yandex_ai_timeout_seconds: float = 30.0
    # 7-страничные HH-резюме доходят до ~25-30к символов; 20к обрезал последние
    # секции (образование, языки). 40к ≈ 13-18к токенов на вход — укладывается
    # в 32к-контекст yandexgpt/rc вместе с system-промптом и schema.
    yandex_ai_max_input_chars: int = 40000

    # ── hh.ru integration ───────────────────────────────────
    # Регистрируется на https://dev.hh.ru. Один аккаунт работодателя на весь CRM —
    # access_token + refresh_token хранятся в БД (таблица integration_tokens,
    # provider='hh'). Без `hh_client_id`/`hh_client_secret` импорт резюме
    # вернёт 503 hh_unavailable, кнопка «Подключить hh» будет показывать,
    # что приложение не сконфигурировано.
    hh_client_id: str = ""
    hh_client_secret: str = ""
    # Куда hh редиректит после авторизации работодателя. Должен совпадать с тем,
    # что прописан в карточке приложения на dev.hh.ru. На каждом контуре свой:
    #   dev     = http://localhost:5173/settings/integrations/hh/callback
    #   staging = https://staging.lachevsky.ru/settings/integrations/hh/callback
    #   prod    = https://crm.lachevsky.ru/settings/integrations/hh/callback
    # Фронт принимает code, отдаёт его на бэк в POST /integrations/hh/oauth/exchange.
    hh_redirect_uri: str = "http://localhost:5173/settings/integrations/hh/callback"
    hh_api_base_url: str = "https://api.hh.ru"
    hh_oauth_base_url: str = "https://hh.ru"
    hh_request_timeout_seconds: float = 20.0
    # User-Agent обязателен для hh API (иначе 400). Пишем контактный email.
    hh_user_agent: str = "CRM-LG/1.0 (titovalexeys@gmail.com)"

    # ── Telegram-бот (уведомления) ──────────────────────────
    # Бот создаётся через @BotFather, токен кладётся в `telegram_bot_token`.
    # Без токена интеграция выключена: ничего не шлётся, кнопка «Подключить
    # Telegram» в настройках показывает, что приложение не сконфигурировано.
    telegram_bot_token: str = ""
    # @username бота (без @) — нужен для deep-link `https://t.me/<username>?start=<token>`.
    telegram_bot_username: str = ""
    # Секрет вебхука: Telegram возвращает его в заголовке
    # `X-Telegram-Bot-Api-Secret-Token` на каждый апдейт — проверяем, чтобы
    # никто не дёргал наш вебхук напрямую. Генерируется один раз (любая строка).
    telegram_webhook_secret: str = ""
    # Полный URL вебхука. Если пуст — собираем из app_base_url + api_v1_prefix.
    # Регистрируется на старте приложения (setWebhook). На localhost оставить
    # пустым и не задавать токен — вебхук недоступен без публичного HTTPS.
    telegram_webhook_url: str = ""
    telegram_request_timeout_seconds: float = 15.0
    # Из РФ (YC) прямой доступ к api.telegram.org часто закрыт (ConnectTimeout),
    # хотя остальной интернет доступен. Тогда исходящие к Bot API гоним через
    # релей вне РФ. Пусто = ходим напрямую (текущее поведение).
    #   TELEGRAM_API_PROXY=http://user:pass@host:port  (или socks5://host:port)
    telegram_api_proxy: str = ""
    # Базовый URL Bot API. Меняется на self-hosted telegram-bot-api сервер вне
    # РФ как альтернатива прокси. По умолчанию — публичный Bot API.
    telegram_api_base: str = "https://api.telegram.org"

    # ── AI-скрининг / STT (Этап 2+) ─────────────────────────
    # WebSocket URL stt-service. Пусто = realtime-транскрипция выключена
    # (комната работает, запись локально → S3, но живого текста не будет).
    #   dev:  ws://localhost:8765
    #   prod: ws://stt:8765  (сервис в docker-compose)
    stt_url: str = "ws://localhost:8765"
    # Hard-stop live-сессии по WS (мин): сервер шлёт session.state max_duration
    # и закрывает поток; клиент обновляет UI.
    screening_max_duration_min: int = 90
    # Сколько секунд после обрыва WS сессия остаётся live (reconnect-окно):
    # столько ждём переподключения клиента, прежде чем закрыть STT-мост.
    screening_ws_hold_sec: int = 60
    # Через сколько минут БЕЗ активности клиента уборщик закрывает live-сессию
    # (рекрутер закрыл вкладку и не вернулся). 0 = не закрывать.
    screening_orphan_grace_min: int = 15
    # Retention аудиозаписей скрининга в S3 (дни). Celery beat
    # `screening.purge_expired_audio` чистит старше порога (152-ФЗ).
    # 0 = не чистить автоматически.
    screening_audio_retention_days: int = 90

    # ── AI-скрининг / realtime-агент (Этап 4) ───────────────
    # false — только транскрипт и ручной чек-лист, без вызовов LLM во время встречи.
    screening_ai_enabled: bool = True
    # Дебаунс после финального сегмента перед тиком агента (сек).
    screening_ai_debounce_sec: float = 8.0
    # Минимальный интервал между успешными вызовами LLM в одной сессии.
    screening_ai_min_interval_sec: float = 8.0
    # Жёсткий потолок вызовов LLM на одну встречу (стоимость / rate-limit).
    screening_ai_max_calls_per_session: int = 40
    # Сколько follow-up вопросов модель может добавить за один тик / за сессию.
    screening_ai_max_followups_per_tick: int = 2
    screening_ai_max_followups_per_session: int = 8
    # Сколько последних сегментов отдаём в промпт как контекст (дельта + хвост).
    screening_ai_transcript_tail: int = 24
    # Грубый бюджет токенов на сессию (вход≈chars/4 + max_tokens ответа).
    # По исчерпании агент замолкает до конца встречи. 0 = без ограничения.
    screening_ai_token_budget: int = 60000

    # ── AI-скрининг / пост-анализ отчёта (Этап 5) ────────────
    # true (dev/tests): анализ после finish в том же процессе (asyncio.create_task).
    # false (prod): Celery worker `screening.analyze_session` (нужен Redis + worker).
    screening_analysis_eager: bool = True

    # ── Сеть ────────────────────────────────────────────────
    # У контейнера есть IPv6-адрес, но нет маршрута наружу (типично для YC-VM
    # без публичного IPv6). DNS отдаёт и A, и AAAA (напр. api.telegram.org),
    # а glibc/httpx по умолчанию предпочитают IPv6 → коннект падает с
    # `[Errno 101] Network is unreachable`, и уведомления в Telegram не уходят.
    # Флаг ставит на старте фильтр getaddrinfo, отбрасывающий IPv6-адреса, —
    # весь исходящий трафик процесса идёт по IPv4. Выключить можно, если на
    # хосте появится рабочий IPv6.
    force_ipv4_egress: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Lazy-singleton: читаем .env один раз за процесс."""
    return Settings()
