"""Доменная логика Telegram-бота уведомлений.

Сценарии:
  * Привязка: фронт зовёт `issue_link_token(user)` → отдаёт пользователю deep-link
    `https://t.me/<bot>?start=<token>`. Пользователь жмёт Start → Telegram шлёт
    боту `/start <token>` → вебхук вызывает `handle_update`, который по токену
    находит пользователя и сохраняет `telegram_chat_id`.
  * Отвязка: `/stop` в боте или `disconnect()` из настроек.
  * Тумблер доставки: `set_enabled(...)`.

Сама рассылка уведомлений — в `app.modules.notifications.telegram_dispatch`.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.redis import get_redis
from app.integrations import telegram as tg_client
from app.modules.users.models import User

log = logging.getLogger(__name__)

_LINK_TTL_SECONDS = 900  # 15 минут на завершение привязки


def is_configured() -> bool:
    return tg_client.is_configured()


# ───────────────────────── link tokens (Redis) ─────────────────────────


def _link_key(token: str) -> str:
    return f"tg:link:{token}"


async def issue_link_token(user: User) -> tuple[str, str | None]:
    """Сгенерировать одноразовый токен привязки и собрать deep-link.

    Возвращает `(token, deep_link)`. `deep_link` = None, если не задан
    `telegram_bot_username` (тогда фронт покажет токен и имя бота текстом).
    """
    token = secrets.token_urlsafe(18)
    redis = get_redis()
    await redis.setex(_link_key(token), _LINK_TTL_SECONDS, str(user.id))
    username = get_settings().telegram_bot_username.lstrip("@")
    deep_link = f"https://t.me/{username}?start={token}" if username else None
    return token, deep_link


async def _consume_link_token(token: str) -> uuid.UUID | None:
    redis = get_redis()
    key = _link_key(token)
    raw = await redis.get(key)
    if raw is None:
        return None
    await redis.delete(key)
    value = raw if isinstance(raw, str) else raw.decode()
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


# ───────────────────────── webhook handling ─────────────────────────


async def handle_update(db: AsyncSession, update: dict[str, Any]) -> None:
    """Обработать апдейт от Telegram (мы подписаны только на `message`)."""
    msg = update.get("message") or update.get("edited_message")
    if not isinstance(msg, dict):
        return
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    text = (msg.get("text") or "").strip()
    if chat_id is None or not text:
        return

    if text.startswith("/start"):
        await _handle_start(db, chat_id=chat_id, text=text)
    elif text.startswith("/stop"):
        await _handle_stop(db, chat_id=chat_id)
    else:
        await tg_client.send_message(
            chat_id,
            "Чтобы получать уведомления CRM, откройте ссылку привязки в профиле "
            "(Настройки → Telegram).",
        )


async def _handle_start(db: AsyncSession, *, chat_id: int, text: str) -> None:
    parts = text.split(maxsplit=1)
    token = parts[1].strip() if len(parts) > 1 else ""
    if not token:
        await tg_client.send_message(
            chat_id,
            "Привет! Это бот уведомлений CRM. Откройте ссылку привязки из "
            "профиля (Настройки → Telegram), чтобы подключить уведомления.",
        )
        return
    user_id = await _consume_link_token(token)
    if user_id is None:
        await tg_client.send_message(
            chat_id, "Ссылка устарела. Сгенерируйте новую в настройках CRM."
        )
        return
    user = await db.get(User, user_id)
    if user is None:
        await tg_client.send_message(chat_id, "Пользователь не найден.")
        return
    user.telegram_chat_id = int(chat_id)
    user.telegram_notifications_enabled = True
    await db.commit()
    await tg_client.send_message(
        chat_id,
        f"✅ Готово, {user.full_name}! Уведомления CRM будут приходить сюда. "
        "Отключить — командой /stop или в настройках.",
    )


async def _handle_stop(db: AsyncSession, *, chat_id: int) -> None:
    user = (
        await db.execute(select(User).where(User.telegram_chat_id == int(chat_id)))
    ).scalar_one_or_none()
    if user is not None:
        user.telegram_chat_id = None
        await db.commit()
    await tg_client.send_message(
        chat_id,
        "Уведомления отключены. Чтобы снова подключить — привяжите бота в "
        "настройках CRM.",
    )


# ───────────────────────── settings API ─────────────────────────


async def status_dto(db: AsyncSession, user: User) -> dict[str, Any]:
    fresh = await db.get(User, user.id)
    connected = fresh is not None and fresh.telegram_chat_id is not None
    return {
        "configured": is_configured(),
        "connected": connected,
        "enabled": bool(fresh.telegram_notifications_enabled) if fresh else True,
        "botUsername": get_settings().telegram_bot_username.lstrip("@") or None,
    }


async def set_enabled(db: AsyncSession, user: User, enabled: bool) -> None:
    fresh = await db.get(User, user.id)
    if fresh is not None:
        fresh.telegram_notifications_enabled = enabled
        await db.commit()


async def disconnect(db: AsyncSession, user: User) -> None:
    fresh = await db.get(User, user.id)
    if fresh is not None:
        fresh.telegram_chat_id = None
        await db.commit()


# ───────────────────────── webhook lifecycle ─────────────────────────


def _webhook_url() -> str:
    settings = get_settings()
    if settings.telegram_webhook_url:
        return settings.telegram_webhook_url
    base = settings.app_base_url.rstrip("/")
    return f"{base}{settings.api_v1_prefix}/integrations/telegram/webhook"


async def register_webhook_if_configured() -> None:
    """Зарегистрировать вебхук на старте приложения.

    Тихо пропускаем, если бот не сконфигурирован или вебхук-URL не https
    (Telegram требует https; на localhost вебхук не поднять без туннеля).
    """
    if not is_configured():
        return
    url = _webhook_url()
    if not url.startswith("https://"):
        log.warning("telegram: webhook URL is not https (%s) — skip setWebhook", url)
        return
    ok = await tg_client.set_webhook(url, get_settings().telegram_webhook_secret)
    if ok:
        log.info("telegram: webhook registered at %s", url)
    else:
        log.error("telegram: failed to register webhook at %s", url)
