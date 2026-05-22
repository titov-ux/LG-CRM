"""SQLAlchemy-модель `users`.

Соответствует архитектуре §6.2 и контракту `User` в `docs/openapi.yaml`.
Email хранится как CITEXT (Postgres-specific) — поиск без учёта регистра без
лишних `LOWER(...)` в индексах.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Enum, String, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampsMixin


class Role(str, enum.Enum):
    """Роли соответствуют enum `Role` в openapi.yaml и `lib/permissions-data.ts` на фронте."""

    admin = "admin"
    account_manager = "account_manager"
    recruiter = "recruiter"
    viewer = "viewer"


class User(Base, TimestampsMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    email: Mapped[str] = mapped_column(CITEXT(), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="user_role", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=Role.recruiter,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    telegram: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # initials/color — производные UI-поля, фронт получает их в DTO.
    # Хранятся в БД, чтобы не пересчитывать на каждый ответ и чтобы UI мог их
    # переопределить (например, для одинаковых инициалов разных пользователей).
    initials: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="#94a3b8")

    # TOTP-секрет (2FA) — заполняется на Этапе 9. Сейчас всегда NULL.
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Технические поля для блокировки/lockout — счётчики живут в Redis,
    # но дата последнего неуспеха кладётся в БД для аудита.
    last_failed_login_at: Mapped[datetime | None] = mapped_column(nullable=True)

    def __repr__(self) -> str:  # pragma: no cover — debug only
        return f"<User {self.email} ({self.role.value})>"


def compute_initials(full_name: str) -> str:
    """«Иванов Иван» → «ИИ», «Анна» → «А». Не больше двух букв."""
    parts = [p for p in full_name.strip().split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][0].upper()
    return (parts[0][0] + parts[1][0]).upper()
