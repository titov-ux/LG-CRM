"""Клиент hh.ru API.

Скоуп первого этапа — импорт резюме по URL/ID:
  * OAuth 2.0 authorization_code flow (один аккаунт работодателя на весь CRM).
  * GET /resumes/{id} — получение полного представления резюме (требует
    employer paid access для контактов; без него часть полей будет null).

Токены хранятся в таблице integration_tokens (provider='hh'). Этот модуль
делает только HTTP-вызовы и парсинг ответа hh; работу с БД и refresh
оркеструет `app.modules.integrations.service`.

Документация hh: https://github.com/hhru/api/blob/master/docs/
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class HhUnavailableError(RuntimeError):
    """Сеть, 5xx, отсутствует ключ — пользователю показываем «временно недоступно»."""


class HhAuthError(RuntimeError):
    """OAuth-ошибки: невалидный code, отозванный refresh_token, 401/403 от API."""


class HhNotFoundError(RuntimeError):
    """Резюме не существует или недоступно этому работодателю."""


class HhRateLimitError(RuntimeError):
    """429 — превышен дневной лимит просмотров резюме."""


@dataclass(slots=True, frozen=True)
class HhTokenPayload:
    access_token: str
    refresh_token: str
    expires_in: int
    scope: str | None
    token_type: str


# ───────────────────────── URL/ID helpers ─────────────────────────

# hh даёт резюме hex-id длиной обычно ~38 символов; берём «достаточно широко».
_RESUME_ID_RE = re.compile(r"^[0-9a-fA-F]{10,64}$")

# Допустимые URL:
#   https://hh.ru/resume/0123456789abcdef
#   https://api.hh.ru/resumes/0123456789abcdef
#   https://spb.hh.ru/resume/0123456789abcdef?query=…
_URL_RESUME_RE = re.compile(
    r"(?:https?://)?(?:[a-z0-9.-]*\.)?hh\.ru/(?:resumes?|api/resumes)/([0-9a-fA-F]{10,64})",
    re.IGNORECASE,
)


def parse_resume_id(raw: str) -> str:
    """Извлекает hh resume_id из URL или принимает уже готовый id.

    Кидает ValueError, если не распознали — фронту показываем «Неверная ссылка hh».
    """
    s = (raw or "").strip()
    if not s:
        raise ValueError("empty resume id/url")
    if _RESUME_ID_RE.match(s):
        return s.lower()
    m = _URL_RESUME_RE.search(s)
    if m:
        return m.group(1).lower()
    raise ValueError(f"cannot parse hh resume id from {s!r}")


def build_authorize_url(state: str) -> str:
    """URL, куда фронт редиректит юзера для логина под работодательским аккаунтом hh."""
    settings = get_settings()
    if not settings.hh_client_id:
        raise HhUnavailableError("hh_client_id is not configured")
    params = {
        "response_type": "code",
        "client_id": settings.hh_client_id,
        "redirect_uri": settings.hh_redirect_uri,
        "state": state,
    }
    return f"{settings.hh_oauth_base_url}/oauth/authorize?{urlencode(params)}"


# ───────────────────────── HTTP клиент ─────────────────────────

def _client() -> httpx.AsyncClient:
    settings = get_settings()
    # User-Agent обязателен — иначе hh отдаёт 400 captcha.
    return httpx.AsyncClient(
        timeout=settings.hh_request_timeout_seconds,
        headers={"User-Agent": settings.hh_user_agent},
        follow_redirects=False,
    )


async def exchange_code(code: str) -> HhTokenPayload:
    """Обмен authorization_code на пару (access_token, refresh_token)."""
    settings = get_settings()
    if not settings.hh_client_id or not settings.hh_client_secret:
        raise HhUnavailableError("hh oauth credentials are not configured")
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.hh_client_id,
        "client_secret": settings.hh_client_secret,
        "redirect_uri": settings.hh_redirect_uri,
        "code": code,
    }
    return await _post_token(data)


async def refresh_token(refresh: str) -> HhTokenPayload:
    """Обновление access_token через refresh_token."""
    settings = get_settings()
    if not settings.hh_client_id or not settings.hh_client_secret:
        raise HhUnavailableError("hh oauth credentials are not configured")
    data = {
        "grant_type": "refresh_token",
        "client_id": settings.hh_client_id,
        "client_secret": settings.hh_client_secret,
        "refresh_token": refresh,
    }
    return await _post_token(data)


async def _post_token(data: dict[str, str]) -> HhTokenPayload:
    settings = get_settings()
    url = f"{settings.hh_oauth_base_url}/oauth/token"
    try:
        async with _client() as cli:
            resp = await cli.post(url, data=data)
    except httpx.HTTPError as exc:
        logger.warning("hh oauth network error: %s", exc)
        raise HhUnavailableError(f"hh oauth network: {exc}") from exc

    if resp.status_code in (400, 401, 403):
        logger.warning("hh oauth rejected: %s %s", resp.status_code, resp.text[:500])
        raise HhAuthError(f"hh oauth {resp.status_code}: {resp.text[:200]}")
    if resp.status_code >= 500:
        raise HhUnavailableError(f"hh oauth 5xx: {resp.status_code}")

    payload = resp.json()
    return HhTokenPayload(
        access_token=payload["access_token"],
        refresh_token=payload.get("refresh_token", ""),
        expires_in=int(payload.get("expires_in", 0)),
        scope=payload.get("scope"),
        token_type=payload.get("token_type", "bearer"),
    )


async def fetch_resume(access_token: str, resume_id: str) -> dict[str, Any]:
    """GET /resumes/{id}. Возвращает «полное представление» (см. employer_resumes.md).

    Полные контакты приходят только если у работодателя оплачен доступ; иначе
    `contact` будет null или замаскирован — это не ошибка модуля.
    """
    settings = get_settings()
    url = f"{settings.hh_api_base_url}/resumes/{resume_id}"
    try:
        async with _client() as cli:
            resp = await cli.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("hh resume fetch network error: %s", exc)
        raise HhUnavailableError(f"hh api network: {exc}") from exc

    if resp.status_code == 200:
        return resp.json()
    if resp.status_code in (401, 403):
        raise HhAuthError(f"hh api {resp.status_code}: {resp.text[:200]}")
    if resp.status_code == 404:
        raise HhNotFoundError("resume not found or not accessible")
    if resp.status_code == 429:
        raise HhRateLimitError("daily resume view limit exceeded")
    raise HhUnavailableError(f"hh api {resp.status_code}: {resp.text[:200]}")


async def fetch_me(access_token: str) -> dict[str, Any]:
    """GET /me — для проверки валидности access_token и получения email/имени менеджера.

    Используется при подключении аккаунта: показываем в UI «Подключён как …».
    """
    settings = get_settings()
    url = f"{settings.hh_api_base_url}/me"
    try:
        async with _client() as cli:
            resp = await cli.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise HhUnavailableError(f"hh api network: {exc}") from exc

    if resp.status_code in (401, 403):
        raise HhAuthError(f"hh /me {resp.status_code}")
    if resp.status_code != 200:
        raise HhUnavailableError(f"hh /me {resp.status_code}")
    return resp.json()
