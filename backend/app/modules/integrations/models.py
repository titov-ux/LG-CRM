"""Модель токенов внешних OAuth-провайдеров.

Per-user: каждый рекрутер подключает свой hh-аккаунт; uniq на (provider, user_id).
Это безопаснее, чем общий корпоративный аккаунт — при увольнении достаточно
отозвать токен конкретного человека, и просмотры резюме списываются с его
персональной квоты hh.

См. миграции 0020_integration_tokens (создание) и 0022_integration_tokens_per_user
(переход на per-user).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampsMixin


class IntegrationToken(Base, TimestampsMixin):
    __tablename__ = "integration_tokens"
    __table_args__ = (
        UniqueConstraint("provider", "user_id", name="uq_integration_tokens_provider_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    access_token: Mapped[str] = mapped_column(Text(), nullable=False)
    refresh_token: Mapped[str] = mapped_column(Text(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scope: Mapped[str | None] = mapped_column(String(255), nullable=True)
    account_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Совпадает с user_id; оставляем для аудита (кто конкретно нажал «Подключить»
    # — может пригодиться, если позже разрешим админам подключать от имени другого).
    connected_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
