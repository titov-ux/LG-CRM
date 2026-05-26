"""Модель файлов в S3.

Сам бинарник лежит в Yandex Object Storage — здесь только метаданные:
* `file_key` — путь в бакете, его генерирует presign-эндпоинт;
* `scan_status` — после загрузки запускается ClamAV в Celery (этап 8+);
* `owner_user_id` — кто залил, для аудита;
* полиморфная entity-ссылка (`entity_type`, `entity_id`) — как у comments,
  файлы привязываются к candidate/vacancy/client/contact.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampsMixin


class FileEntityType(str, enum.Enum):
    candidate = "candidate"
    vacancy = "vacancy"
    client = "client"
    contact = "contact"
    # Добавлено миграцией 0015_chat_threads_attachments (Этап 4 чата) —
    # вложения в сообщения чата; entity_id ссылается на chat_messages.id.
    chat_message = "chat_message"


class ScanStatus(str, enum.Enum):
    pending = "pending"
    clean = "clean"
    infected = "infected"
    error = "error"


def _enum_values(e):
    return [m.value for m in e]


class File(Base, TimestampsMixin):
    __tablename__ = "files"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    # nullable=True + SET NULL: файл остаётся, владелец сбрасывается.
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    entity_type: Mapped[FileEntityType] = mapped_column(
        Enum(FileEntityType, name="file_entity_type", values_callable=_enum_values),
        nullable=False,
        index=True,
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    file_key: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    original_name: Mapped[str] = mapped_column(String(512), nullable=False)
    mime: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger(), nullable=False)
    scan_status: Mapped[ScanStatus] = mapped_column(
        Enum(ScanStatus, name="scan_status", values_callable=_enum_values),
        nullable=False,
        default=ScanStatus.pending,
    )
    scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
