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
    yandex_ai_max_input_chars: int = 20000


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Lazy-singleton: читаем .env один раз за процесс."""
    return Settings()
