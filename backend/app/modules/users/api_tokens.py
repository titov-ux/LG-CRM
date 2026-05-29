"""Personal API-токены пользователей.

Используются Chrome-расширением hh.ru (см. extension/). Формат raw-токена:
`lg_<32 base64-chars>`. В БД храним только sha256, plaintext отдаём
пользователю один раз при создании.
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

TOKEN_PREFIX = "lg_"


class UserApiToken(Base):
    __tablename__ = "user_api_tokens"

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
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


def generate_raw_token() -> str:
    """`lg_` + 32 url-safe символа. Энтропии больше, чем у UUID, и не путается с JWT."""
    return TOKEN_PREFIX + secrets.token_urlsafe(24)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def is_extension_token(raw: str) -> bool:
    """Префикс отличает наш токен от JWT в одном Authorization-заголовке."""
    return raw.startswith(TOKEN_PREFIX)
