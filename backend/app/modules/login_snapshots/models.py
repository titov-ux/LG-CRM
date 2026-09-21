"""SQLAlchemy-модель `login_snapshots`.

Одна строка — одна попытка снять кадр при входе. Кадр может физически
отсутствовать (камера запрещена/недоступна) — тогда `s3_key IS NULL`, а `status`
объясняет причину. Это осознанно: сам факт входа без снимка тоже полезен для
службы безопасности.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SnapshotStatus(str, enum.Enum):
    """Итог попытки сделать снимок при входе."""

    ok = "ok"                # кадр получен и загружен в S3
    denied = "denied"        # пользователь не дал доступ к камере
    no_camera = "no_camera"  # устройство без камеры / камера занята
    error = "error"          # прочая ошибка захвата/загрузки


def _enum_values(e):
    return [m.value for m in e]


class LoginSnapshot(Base):
    __tablename__ = "login_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    # SET NULL: журнал снимков переживает удаление пользователя как
    # исторический артефакт безопасности (паттерн миграции 0011).
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[SnapshotStatus] = mapped_column(
        Enum(SnapshotStatus, name="login_snapshot_status", values_callable=_enum_values),
        nullable=False,
    )
    # Ключ объекта в S3. NULL, если кадр не был получен (denied/no_camera/error).
    s3_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()"), index=True
    )

    def __repr__(self) -> str:  # pragma: no cover — debug only
        return f"<LoginSnapshot {self.user_id} {self.status.value} {self.created_at}>"
