"""Файлы кадрового ЭДО в S3 (префикс `hr-edo/`) + хеши.

Загрузка только серверная (`S3Adapter.upload_bytes`): бэкенд сам считает
SHA-256 и Стрибог-256 и кладёт ровно те байты, которые захешировал. При
чтении исходника хеш сверяется заново — подмена файла в бакете после
заморозки обнаруживается и подпись не создаётся.

Для Object Lock (retention по сроку хранения) — см. Этап 2.4.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid

import gostcrypto
from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.integrations.s3 import S3Adapter, get_s3_adapter
from app.modules.files.models import File, FileEntityType, ScanStatus

PREFIX = "hr-edo"
log = logging.getLogger(__name__)

_s3_override: S3Adapter | None = None


def set_s3_for_tests(adapter: S3Adapter | None) -> None:
    global _s3_override
    _s3_override = adapter


def s3() -> S3Adapter:
    return _s3_override or get_s3_adapter()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def streebog256_hex(data: bytes) -> str:
    """ГОСТ Р 34.11-2012, 256 бит."""
    h = gostcrypto.gosthash.new("streebog256", data=data)
    return str(h.hexdigest())


async def put_file(
    db: AsyncSession,
    *,
    document_id: uuid.UUID,
    kind: str,
    data: bytes,
    mime: str,
    original_name: str,
    owner_user_id: uuid.UUID | None,
) -> File:
    safe_kind = "".join(ch for ch in kind if ch.isalnum() or ch in "-_") or "file"
    ext = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else "bin"
    key = f"{PREFIX}/{document_id}/{safe_kind}-{uuid.uuid4().hex[:12]}.{ext}"
    try:
        await asyncio.to_thread(s3().upload_bytes, file_key=key, data=data, mime=mime)
    except Exception as exc:
        log.exception("hr_edo: S3 upload failed (%s)", key)
        raise ApiError(
            status.HTTP_502_BAD_GATEWAY,
            "storage_unavailable",
            "Хранилище файлов недоступно — документ не сохранён. Попробуйте позже.",
        ) from exc
    rec = File(
        owner_user_id=owner_user_id,
        entity_type=FileEntityType.hr_document,
        entity_id=document_id,
        file_key=key,
        original_name=original_name[:500],
        mime=mime,
        size=len(data),
        # Файлы генерирует сам сервер (или это подписи/сканы, проверенные на входе).
        scan_status=ScanStatus.clean,
    )
    db.add(rec)
    await db.flush()
    return rec


async def read_file(db: AsyncSession, file_id: uuid.UUID) -> tuple[File, bytes]:
    rec = await db.get(File, file_id)
    if rec is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Файл не найден")
    try:
        data = await asyncio.to_thread(s3().download_bytes, file_key=rec.file_key)
    except Exception as exc:
        log.exception("hr_edo: S3 download failed (%s)", rec.file_key)
        raise ApiError(
            status.HTTP_502_BAD_GATEWAY,
            "storage_unavailable",
            "Хранилище файлов недоступно. Попробуйте позже.",
        ) from exc
    return rec, data


async def read_verified(db: AsyncSession, file_id: uuid.UUID, expected_sha256: str | None) -> bytes:
    """Прочитать замороженный исходник и сверить хеш."""
    _, data = await read_file(db, file_id)
    if expected_sha256 and sha256_hex(data) != expected_sha256:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "integrity_error",
            "Файл документа не совпадает с замороженным хешем. Подпись невозможна — обратитесь к кадровику.",
        )
    return data
