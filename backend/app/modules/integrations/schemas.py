"""DTO модуля integrations."""
from __future__ import annotations

import uuid

from pydantic import Field

from app.core.schemas import CamelModel


class HhStatusResponse(CamelModel):
    configured: bool
    connected: bool
    account_label: str | None = None
    expires_at: str | None = None


class HhAuthorizeUrlResponse(CamelModel):
    authorize_url: str
    state: str


class HhExchangeCodeRequest(CamelModel):
    code: str = Field(min_length=1)
    state: str = Field(min_length=1)


class HhImportResumeRequest(CamelModel):
    """Принимаем url ИЛИ id — сервер разберётся."""

    url: str = Field(min_length=1, description="URL резюме hh.ru или его hex-id")
    vacancy_id: uuid.UUID | None = None
    recruiter_id: uuid.UUID | None = None


# ── Telegram ─────────────────────────────────────────────────────────────


class TelegramStatusResponse(CamelModel):
    configured: bool          # на сервере задан telegram_bot_token
    connected: bool           # у пользователя сохранён chat_id (бот привязан)
    enabled: bool             # тумблер доставки уведомлений
    bot_username: str | None = None


class TelegramLinkResponse(CamelModel):
    configured: bool
    token: str
    # deep_link = None, если не задан telegram_bot_username — фронт покажет
    # инструкцию с токеном вручную.
    deep_link: str | None = None


class TelegramSettingsRequest(CamelModel):
    enabled: bool
