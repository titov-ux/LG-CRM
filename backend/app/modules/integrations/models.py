"""Модель токенов внешних OAuth-провайдеров.

Одна строка на provider (provider='hh' и т.д.). Раздавать токены по
пользователям не нужно — у нас один аккаунт работодателя hh на весь CRM.

См. миграцию 0020_integration_tokens.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampsMixin


class IntegrationToken(Base, TimestampsMixin):
    __tablename__ = "integration_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    access_token: Mapped[str] = mapped_column(Text(), nullable=False)
    refresh_token: Mapped[str] = mapped_column(Text(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scope: Mapped[str | None] = mapped_column(String(255), nullable=True)
    account_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    connected_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
