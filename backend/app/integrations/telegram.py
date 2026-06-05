"""Низкоуровневый клиент Telegram Bot API.

Только HTTP-вызовы, без знания о БД и доменной логике. Доменная обвязка
(привязка chat_id, разбор апдейтов, рассылка уведомлений) — в
`app.modules.integrations.telegram_service`.

Без `telegram_bot_token` интеграция считается невыключенной: `is_configured()`
вернёт False, а вызовы тихо деградируют (логируем и возвращаем False/None) —
так же, как SMTP в `app.integrations.email`.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)

def is_configured() -> bool:
    return bool(get_settings().telegram_bot_token)


def _method_url(token: str, method: str) -> str:
    base = get_settings().telegram_api_base.rstrip("/")
    return f"{base}/bot{token}/{method}"


async def _call(method: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """Вызвать метод Bot API. Возвращает `result` или None при ошибке/отсутствии токена."""
    settings = get_settings()
    token = settings.telegram_bot_token
    if not token:
        log.warning("Telegram not configured — skip %s", method)
        return None
    # Прямой путь к Telegram из РФ часто закрыт — при заданном
    # telegram_api_proxy идём через релей вне РФ (см. config).
    proxy = settings.telegram_api_proxy or None
    try:
        async with httpx.AsyncClient(
            timeout=settings.telegram_request_timeout_seconds,
            proxy=proxy,
        ) as client:
            resp = await client.post(_method_url(token, method), json=payload)
        data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        # str(e) у таймаутов/ConnectError часто пустой — логируем тип через repr,
        # иначе в проде видно лишь «failed: » без причины.
        log.error("Telegram %s failed: %r", method, e)
        return None
    if not data.get("ok"):
        log.error("Telegram %s returned error: %s", method, data.get("description"))
        return None
    return data.get("result")


async def send_message(
    chat_id: int, text: str, *, parse_mode: str | None = None
) -> bool:
    """Отправить текстовое сообщение. True, если ушло.

    По умолчанию `parse_mode` НЕ задаётся: тексты уведомлений подставляют сырые
    названия сущностей (имя кандидата, заголовок вакансии и т.п.), которые могут
    содержать `&`, `<`, `>`. С `parse_mode="HTML"` такой текст Telegram отвергает
    с 400 «can't parse entities», и сообщение молча теряется. Если нужна разметка
    — передавайте `parse_mode` явно и экранируйте текст на стороне вызова.
    """
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    result = await _call("sendMessage", payload)
    return result is not None


async def get_me() -> dict[str, Any] | None:
    """Информация о боте (в т.ч. username) — для deep-link и диагностики."""
    return await _call("getMe", {})


async def set_webhook(url: str, secret: str) -> bool:
    """Зарегистрировать вебхук. Telegram будет слать апдейты на `url` и
    добавлять заголовок `X-Telegram-Bot-Api-Secret-Token: <secret>`."""
    payload: dict[str, Any] = {"url": url, "allowed_updates": ["message"]}
    if secret:
        payload["secret_token"] = secret
    return await _call("setWebhook", payload) is not None


async def delete_webhook() -> bool:
    return await _call("deleteWebhook", {"drop_pending_updates": False}) is not None
