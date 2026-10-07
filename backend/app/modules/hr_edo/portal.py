"""Публичный портал подписания: ссылки и сессии.

* Ссылка `/sign/{token}` — 256 бит энтропии, в БД только SHA-256 (как у
  `password_invites`), срок — `HR_EDO_LINK_TTL_DAYS`. Новая ссылка отзывает
  предыдущие ссылки сотрудника, поэтому «старая» (использованная) ссылка
  больше не пускает.
* Вход — по ссылке + SMS-коду (`purpose=portal_login`). После входа —
  httpOnly-cookie с сессией на `HR_EDO_PORTAL_SESSION_MINUTES` (скользящее
  окно). Сессия хранится в Redis по SHA-256 от cookie.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import status
from redis.asyncio import Redis
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.modules.hr_edo.models import HrAccessToken, HrEmployee, HrEmployeeStatus

SESSION_COOKIE = "hr_sign_session"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def issue_access_token(
    db: AsyncSession, employee: HrEmployee, *, created_by: uuid.UUID | None
) -> str:
    """Выдать новую ссылку (старые отзываются). Возвращает сырой токен."""
    await db.execute(
        update(HrAccessToken)
        .where(HrAccessToken.employee_id == employee.id, HrAccessToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    raw = secrets.token_urlsafe(32)
    db.add(
        HrAccessToken(
            employee_id=employee.id,
            token_hash=_hash(raw),
            expires_at=_now() + timedelta(days=get_settings().hr_edo_link_ttl_days),
            created_by=created_by,
        )
    )
    await db.flush()
    return raw


async def resolve_token(db: AsyncSession, raw: str) -> tuple[HrAccessToken, HrEmployee]:
    from sqlalchemy import select

    tok = (
        await db.execute(select(HrAccessToken).where(HrAccessToken.token_hash == _hash(raw)))
    ).scalar_one_or_none()
    if tok is None or tok.revoked_at is not None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "link_invalid",
            "Ссылка недействительна. Попросите кадровика прислать новую.",
        )
    if tok.expires_at <= _now():
        raise ApiError(status.HTTP_410_GONE, "link_expired", "Срок действия ссылки истёк. Попросите кадровика прислать новую.")
    emp = await db.get(HrEmployee, tok.employee_id)
    if emp is None or emp.status != HrEmployeeStatus.active:
        raise ApiError(status.HTTP_404_NOT_FOUND, "link_invalid", "Ссылка недействительна")
    return tok, emp


def _session_key(raw: str) -> str:
    return f"hr_edo:portal:session:{_hash(raw)}"


def session_ttl_seconds() -> int:
    return get_settings().hr_edo_portal_session_minutes * 60


def _phone_tag(phone: str | None) -> str:
    return hashlib.sha256((phone or "").encode()).hexdigest()[:16]


async def open_session(
    redis: Redis, *, employee_id: uuid.UUID, token_id: uuid.UUID, phone: str | None
) -> str:
    raw = secrets.token_urlsafe(32)
    await redis.set(
        _session_key(raw),
        # Сессия привязана к номеру, на который пришёл код входа: смена номера
        # (утеря SIM) сразу закрывает все открытые сессии портала.
        json.dumps({"employeeId": str(employee_id), "tokenId": str(token_id), "phone": _phone_tag(phone)}),
        ex=session_ttl_seconds(),
    )
    return raw


def session_matches_phone(session_phone: str | None, phone: str | None) -> bool:
    return session_phone == _phone_tag(phone)


async def read_session(redis: Redis, raw: str | None) -> tuple[uuid.UUID, uuid.UUID, str | None]:
    if not raw:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "portal_session_required", "Войдите по ссылке из письма")
    key = _session_key(raw)
    data = await redis.get(key)
    if not data:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "portal_session_expired", "Сессия истекла — войдите заново")
    # Скользящее окно: активность продлевает сессию.
    await redis.expire(key, session_ttl_seconds())
    parsed = json.loads(data)
    return uuid.UUID(parsed["employeeId"]), uuid.UUID(parsed["tokenId"]), parsed.get("phone")


async def close_session(redis: Redis, raw: str | None) -> None:
    if raw:
        await redis.delete(_session_key(raw))
