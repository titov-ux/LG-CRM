"""SMS-провайдер для одноразовых кодов кадрового ЭДО.

Интерфейс минимальный — `send` / `status`. Провайдер выбирается настройкой
`SMS_PROVIDER`:

* `log` — только ENV=dev (иначе приложение не стартует, см.
  `core.config.validate_hr_edo_settings`). SMS не уходит: сообщение кладётся в
  in-memory dev-outbox (его читает `GET /hr-edo/dev/sms-outbox`), а в лог
  пишется маскированная версия — без кода и с замаскированным номером.
  Текст SMS с кодом не должен попадать ни в логи, ни в Sentry.
* `smsc` — SMSC.ru (HTTP API, `fmt=3` → JSON). Другой провайдер (SMS Aero,
  МТС Exolve) добавляется ещё одной реализацией `SmsProvider`.

Нужен договор поручения обработки ПДн с провайдером (152-ФЗ).
"""
from __future__ import annotations

import logging
import re
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from typing import Protocol

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)

# Одноразовый код — ровно 6 цифр (otp.CODE_LENGTH).
_CODE_RE = re.compile(r"(?<![\d\w])\d{6}(?![\d\w])")
# Российский мобильный в любом написании: +7 999 123-45-67, 8(999)1234567, 79991234567.
_PHONE_RE = re.compile(r"(?:\+7|(?<!\d)[78])[\s\-(]*\d{3}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)")


def mask_phone(phone: str | None) -> str:
    """`+79991234567` → `+7 ••• ••• 45-67`."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) < 4:
        return "•••"
    tail = digits[-4:]
    country = digits[:-10] if len(digits) > 10 else "7"
    if country == "8":  # внутрироссийская запись 8XXXXXXXXXX
        country = "7"
    return f"+{country} ••• ••• {tail[:2]}-{tail[2:]}"


def scrub_sensitive(text: str) -> str:
    """Замаскировать коды и номера телефонов в произвольной строке.

    Используется для логов и Sentry (before_send в main.py).
    """
    text = _PHONE_RE.sub(lambda m: mask_phone(m.group(0)), text)
    return _CODE_RE.sub("••••••", text)


@dataclass(frozen=True)
class SmsResult:
    provider_id: str | None
    # queued | sent | delivered | failed
    status: str
    error: str | None = None


class SmsProvider(Protocol):
    name: str

    async def send(self, *, phone: str, text: str) -> SmsResult: ...

    async def status(self, *, provider_id: str, phone: str) -> str: ...


@dataclass(frozen=True)
class DevSms:
    phone: str
    text: str
    sent_at: datetime


# Последние SMS dev-режима. Живут в памяти процесса: переживать рестарт им не нужно.
DEV_SMS_OUTBOX: deque[DevSms] = deque(maxlen=50)


class LogSmsProvider:
    name = "log"

    async def send(self, *, phone: str, text: str) -> SmsResult:
        DEV_SMS_OUTBOX.appendleft(DevSms(phone=phone, text=text, sent_at=datetime.now(timezone.utc)))
        log.warning(
            "SMS_PROVIDER=log — SMS не отправлено (dev). to=%s text=%s",
            mask_phone(phone),
            scrub_sensitive(text),
        )
        return SmsResult(provider_id=None, status="delivered")

    async def status(self, *, provider_id: str, phone: str) -> str:
        return "delivered"


# SMSC: https://smsc.ru/api/http/ — коды статусов сообщений.
_SMSC_STATUS = {
    -3: "failed",  # сообщение не найдено
    -1: "queued",  # ожидает отправки
    0: "sent",  # передано оператору
    1: "delivered",
    2: "delivered",  # прочитано
    3: "failed",  # просрочено
    4: "sent",  # нажата ссылка
    20: "failed",  # невозможно доставить
    22: "failed",  # неверный номер
    23: "failed",  # запрещено
    24: "failed",  # недостаточно средств
    25: "failed",  # недоступный номер
}


class SmscSmsProvider:
    name = "smsc"

    def __init__(self) -> None:
        s = get_settings()
        self._base = s.sms_api_base.rstrip("/")
        self._login = s.sms_login
        self._password = s.sms_password or s.sms_api_key
        self._sender = s.sms_sender
        self._timeout = s.sms_timeout_seconds

    async def send(self, *, phone: str, text: str) -> SmsResult:
        params = {
            "login": self._login,
            "psw": self._password,
            "phones": phone.lstrip("+"),
            "mes": text,
            "sender": self._sender,
            "fmt": "3",
            "charset": "utf-8",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(f"{self._base}/sys/send.php", data=params)
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            # Сообщение исключения не логируем целиком: в нём может быть тело запроса.
            log.error("sms.smsc: send failed (%s)", exc.__class__.__name__)
            return SmsResult(provider_id=None, status="failed", error=exc.__class__.__name__)
        if "error" in data:
            log.error("sms.smsc: provider error code=%s", data.get("error_code"))
            return SmsResult(provider_id=None, status="failed", error=str(data.get("error_code")))
        return SmsResult(provider_id=str(data.get("id")), status="queued")

    async def status(self, *, provider_id: str, phone: str) -> str:
        params = {
            "login": self._login,
            "psw": self._password,
            "phone": phone.lstrip("+"),
            "id": provider_id,
            "fmt": "3",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(f"{self._base}/sys/status.php", params=params)
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            return "queued"
        try:
            return _SMSC_STATUS.get(int(data.get("status", -1)), "queued")
        except (TypeError, ValueError):
            return "queued"


@lru_cache(maxsize=1)
def get_sms_provider() -> SmsProvider:
    """DI-провайдер; в тестах подменяется через `set_sms_provider_for_tests`."""
    settings = get_settings()
    if settings.sms_provider == "smsc":
        return SmscSmsProvider()
    return LogSmsProvider()


_override: SmsProvider | None = None


def set_sms_provider_for_tests(provider: SmsProvider | None) -> None:
    global _override
    _override = provider


def sms_provider() -> SmsProvider:
    return _override or get_sms_provider()
