"""Модель `password_invites` и хелперы для invite-токенов.

Когда админ заводит нового пользователя без пароля — мы создаём `PasswordInvite`
со случайным токеном (raw возвращается админу/уходит в email; в БД лежит SHA-256
хэш, как у CSRF-токенов), выставляем `is_active=false` на самом юзере и шлём
письмо со ссылкой `https://lachevsky.ru/invite/{raw_token}`.

Когда пользователь переходит по ссылке и задаёт пароль:
- проверяем токен (хэш + не истёк + ещё не использован),
- ставим новый `password_hash`,
- проставляем `is_active=true`,
- помечаем `used_at` у инвайта.

Намеренно не делаем общий «password reset» — это узкий поток только для первой
активации. Сброс пароля живущего юзера — отдельная история (Этап 9, 2FA).
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Срок жизни invite по умолчанию — 7 дней (см. memory: согласовано с пользователем).
INVITE_TTL_DAYS = 7

# Длина «сырого» токена. 32 байта → 43 символа base64url — это ~256 бит энтропии,
# больше чем достаточно даже без HMAC.
_RAW_TOKEN_BYTES = 32


def generate_raw_token() -> str:
    """URL-safe токен без `=` на конце."""
    return secrets.token_urlsafe(_RAW_TOKEN_BYTES)


def hash_token(raw: str) -> str:
    """SHA-256 от сырого токена. Хранится в БД, ищется по хэшу при активации."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class PasswordInvite(Base):
    __tablename__ = "password_invites"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # SHA-256 hex = 64 символа. Уникальность — чтобы коллизия (пусть и невозможная)
    # не могла активировать чужой аккаунт.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        nullable=False,
    )
