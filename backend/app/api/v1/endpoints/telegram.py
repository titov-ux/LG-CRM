"""Эндпоинты /integrations/telegram.

  * GET  /integrations/telegram/status      — статус привязки (для UI настроек)
  * POST /integrations/telegram/link/start  — выдать deep-link для привязки бота
  * PATCH /integrations/telegram/settings    — вкл/выкл доставку уведомлений
  * POST /integrations/telegram/disconnect  — отвязать бота
  * POST /integrations/telegram/webhook     — приём апдейтов от Telegram (БЕЗ auth,
    защищён секретным заголовком X-Telegram-Bot-Api-Secret-Token)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.integrations import telegram_service as service
from app.modules.integrations.schemas import (
    TelegramLinkResponse,
    TelegramSettingsRequest,
    TelegramStatusResponse,
)
from app.modules.users.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/telegram", tags=["integrations"])


@router.get(
    "/status",
    response_model=TelegramStatusResponse,
    summary="Статус привязки Telegram текущего пользователя",
)
async def get_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TelegramStatusResponse:
    data = await service.status_dto(db, user)
    return TelegramStatusResponse(
        configured=data["configured"],
        connected=data["connected"],
        enabled=data["enabled"],
        bot_username=data["botUsername"],
    )


@router.post(
    "/link/start",
    response_model=TelegramLinkResponse,
    summary="Сгенерировать deep-link для привязки бота",
)
async def link_start(
    user: User = Depends(get_current_user),
    _: AsyncSession = Depends(get_db),
) -> TelegramLinkResponse:
    token, deep_link = await service.issue_link_token(user)
    return TelegramLinkResponse(
        configured=service.is_configured(),
        token=token,
        deep_link=deep_link,
    )


@router.patch(
    "/settings",
    response_model=TelegramStatusResponse,
    summary="Включить/выключить доставку уведомлений в Telegram",
)
async def update_settings(
    payload: TelegramSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TelegramStatusResponse:
    await service.set_enabled(db, user, payload.enabled)
    data = await service.status_dto(db, user)
    return TelegramStatusResponse(
        configured=data["configured"],
        connected=data["connected"],
        enabled=data["enabled"],
        bot_username=data["botUsername"],
    )


@router.post(
    "/disconnect",
    response_model=OkResponse,
    summary="Отвязать Telegram-бота",
)
async def disconnect(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.disconnect(db, user)
    return OkResponse()


@router.post(
    "/webhook",
    summary="Приём апдейтов Telegram (вызывается самим Telegram)",
    include_in_schema=False,
)
async def webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, bool]:
    settings = get_settings()
    # Защита: принимаем апдейт только если секрет совпал (его знает только
    # Telegram, т.к. мы передали его в setWebhook). При несовпадении — 200 без
    # обработки, чтобы не раскрывать наличие эндпоинта и не провоцировать ретраи.
    expected = settings.telegram_webhook_secret
    if expected and x_telegram_bot_api_secret_token != expected:
        logger.warning("telegram webhook: bad secret token")
        return {"ok": False}
    try:
        update = await request.json()
    except ValueError:
        return {"ok": False}
    await service.handle_update(db, update)
    return {"ok": True}
