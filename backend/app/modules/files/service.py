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
from app.modules.permissions.entity_access import ensure_entity_access
from app.modules.users.models import User


def _normalize_mime(mime: str) -> str:
    """MediaRecorder шлёт `audio/webm;codecs=opus` — в белом списке только база."""
    return (mime or "").split(";", 1)[0].strip().lower()


def _validate_upload(mime: str, size: int) -> None:
    settings = get_settings()
    mime = _normalize_mime(mime)
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


def _reject_hr_document(entity_type: FileEntityType) -> None:
    """Файлы кадрового ЭДО кладёт только сервер (/hr-edo/*) — с хешами и протоколом."""
    if entity_type == FileEntityType.hr_document:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "entity_type_forbidden",
            "Файлы кадровых документов загружаются через раздел «Кадровые документы»",
        )


async def presign(
    db: AsyncSession, s3: S3Adapter, user: User, payload: PresignRequest
) -> tuple[str, dict[str, str], str, int]:
    _reject_hr_document(payload.entity_type)
    await ensure_entity_access(db, user, payload.entity_type, payload.entity_id, write=True)
    mime = _normalize_mime(payload.mime)
    _validate_upload(mime, payload.size)
    settings = get_settings()
    file_key = make_file_key(
        entity_type=payload.entity_type.value,
        entity_id=payload.entity_id,
        original_name=payload.original_name,
    )
    presigned = s3.presign_post(
        file_key=file_key, mime=mime, max_bytes=settings.file_max_bytes
    )
    return presigned.url, presigned.fields, presigned.file_key, settings.file_max_bytes


async def confirm(
    db: AsyncSession, user: User, payload: ConfirmRequest
) -> File:
    _reject_hr_document(payload.entity_type)
    await ensure_entity_access(db, user, payload.entity_type, payload.entity_id, write=True)
    mime = _normalize_mime(payload.mime)
    _validate_upload(mime, payload.size)
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
        if existing.owner_user_id != user.id:
            raise ApiError(
                status.HTTP_409_CONFLICT, "file_key_taken", "Файл уже подтверждён"
            )
        return existing  # идемпотентно
    rec = File(
        owner_user_id=user.id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        file_key=payload.file_key,
        original_name=payload.original_name,
        mime=mime,
        size=payload.size,
        scan_status=ScanStatus.pending,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


async def list_for_entity(
    db: AsyncSession, user: User, entity_type: FileEntityType, entity_id: uuid.UUID
) -> list[File]:
    """Файлы сущности — только если пользователь видит саму сущность."""
    await ensure_entity_access(db, user, entity_type, entity_id)
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


async def ensure_can_read_file(
    db: AsyncSession, user: User, file: File
) -> None:
    """Проверка прав на чтение (download/просмотр) файла.

    Права на файл = права на сущность, к которой он привязан
    (см. `permissions.entity_access`): кандидат — `candidate:view`, вакансия —
    `vacancy:view` + «только свои» для AM, лид/тендер — правила их карточек,
    запись скрининга — видимость сессии + `screening:run`/`view_report`,
    вложение чата — членство в диалоге. Раньше для всего, кроме чата, хватало
    логина — так утекали резюме и записи интервью.

    Файлы кадрового ЭДО (entity_type=hr_document) через общий /files не
    отдаются никому: у них своя выдача в /hr-edo/* с проверкой прав,
    целостности и записью в протокол.
    """
    try:
        await ensure_entity_access(db, user, file.entity_type, file.entity_id)
    except ApiError as exc:
        if exc.status_code == status.HTTP_403_FORBIDDEN:
            raise
        # Сущность удалена или скрыта — не палим существование файла.
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Файл не найден") from exc


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
    if file.entity_type == FileEntityType.hr_document:
        # Замороженные кадровые документы, подписи и сканы неизменны.
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "hr_document_immutable",
            "Файлы кадрового ЭДО удалить нельзя",
        )
    # Только владелец или admin может удалять.
    from app.modules.users.models import Role

    if file.owner_user_id != user.id and user.role != Role.admin:
        raise ApiError(
            status.HTTP_403_FORBIDDEN, "forbidden", "Удалять файл может владелец или админ"
        )
    s3.delete(file_key=file.file_key)
    await db.delete(file)
    await db.commit()
