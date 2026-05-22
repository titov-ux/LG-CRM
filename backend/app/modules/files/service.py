"""Сервис файлов: presign, confirm, list, download, delete."""
from __future__ import annotations

import uuid

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.integrations.s3 import ALLOWED_MIME_TYPES, S3Adapter, make_file_key
from app.modules.files.models import File, FileEntityType, ScanStatus
from app.modules.files.schemas import ConfirmRequest, PresignRequest
from app.modules.users.models import User


def _validate_upload(mime: str, size: int) -> None:
    settings = get_settings()
    if mime not in ALLOWED_MIME_TYPES:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "unsupported_mime",
            f"Тип файла {mime} не поддерживается",
            details={"allowed": sorted(ALLOWED_MIME_TYPES)},
        )
    if size <= 0 or size > settings.file_max_bytes:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "file_too_large",
            f"Размер файла должен быть от 1 байта до {settings.file_max_bytes} байт",
            details={"maxBytes": settings.file_max_bytes},
        )


async def presign(
    s3: S3Adapter, payload: PresignRequest
) -> tuple[str, dict[str, str], str, int]:
    _validate_upload(payload.mime, payload.size)
    settings = get_settings()
    file_key = make_file_key(
        entity_type=payload.entity_type.value,
        entity_id=payload.entity_id,
        original_name=payload.original_name,
    )
    presigned = s3.presign_post(
        file_key=file_key, mime=payload.mime, max_bytes=settings.file_max_bytes
    )
    return presigned.url, presigned.fields, presigned.file_key, settings.file_max_bytes


async def confirm(
    db: AsyncSession, user: User, payload: ConfirmRequest
) -> File:
    _validate_upload(payload.mime, payload.size)
    # Проверка, что file_key соответствует ожидаемому префиксу — анти-подмена.
    expected_prefix = f"{payload.entity_type.value}/{payload.entity_id}/"
    if not payload.file_key.startswith(expected_prefix):
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "file_key_mismatch",
            "file_key не соответствует заявленной сущности",
        )
    existing = (
        await db.execute(select(File).where(File.file_key == payload.file_key))
    ).scalar_one_or_none()
    if existing is not None:
        return existing  # идемпотентно
    rec = File(
        owner_user_id=user.id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        file_key=payload.file_key,
        original_name=payload.original_name,
        mime=payload.mime,
        size=payload.size,
        scan_status=ScanStatus.pending,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


async def list_for_entity(
    db: AsyncSession, entity_type: FileEntityType, entity_id: uuid.UUID
) -> list[File]:
    rows = await db.execute(
        select(File)
        .where(File.entity_type == entity_type, File.entity_id == entity_id)
        .order_by(File.created_at.desc())
    )
    return list(rows.scalars().all())


async def get_file(db: AsyncSession, file_id: uuid.UUID) -> File:
    rec = await db.get(File, file_id)
    if rec is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Файл не найден")
    return rec


async def download_url(s3: S3Adapter, file: File, expires_in: int = 300) -> str:
    if file.scan_status == ScanStatus.infected:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "file_infected",
            "Антивирус нашёл угрозу — файл выдан не будет",
        )
    return s3.presign_get(file_key=file.file_key, expires_in=expires_in)


async def delete_file(
    db: AsyncSession, s3: S3Adapter, user: User, file_id: uuid.UUID
) -> None:
    file = await get_file(db, file_id)
    # Только владелец или admin может удалять.
    from app.modules.users.models import Role

    if file.owner_user_id != user.id and user.role != Role.admin:
        raise ApiError(
            status.HTTP_403_FORBIDDEN, "forbidden", "Удалять файл может владелец или админ"
        )
    s3.delete(file_key=file.file_key)
    await db.delete(file)
    await db.commit()
