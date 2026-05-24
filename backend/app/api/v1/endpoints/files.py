"""Эндпоинты /files.

Загрузка файлов идёт через presigned POST в S3 — браузер льёт напрямую в
Yandex Object Storage, минуя бэкенд. Бэк только подтверждает наличие и хранит
метаданные.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.db.session import get_db
from app.integrations.s3 import S3Adapter, get_s3_adapter
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.files import service
from app.modules.files.pdf_service import render_pdf_from_html
from app.modules.files.models import File, FileEntityType
from app.modules.files.schemas import (
    ConfirmRequest,
    DownloadResponse,
    FileResponse,
    PresignRequest,
    PresignResponse,
    RenderPdfRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/files", tags=["files"])


def _s3_dep() -> S3Adapter:
    return get_s3_adapter()


def _to_dto(f: File) -> FileResponse:
    return FileResponse.model_validate(f)


def _pdf_error_details(exc: Exception) -> dict[str, str]:
    raw_message = str(exc).strip()
    first_line = raw_message.splitlines()[0] if raw_message else exc.__class__.__name__
    details: dict[str, str] = {
        "errorType": exc.__class__.__name__,
        "errorMessage": first_line[:300],
    }
    lower = raw_message.lower()
    if "playwright" in lower and ("executable doesn't exist" in lower or "playwright install" in lower):
        details["hint"] = "Run `python -m playwright install chromium` on backend host."
    return details


@router.post("/presign", response_model=PresignResponse, summary="Получить presigned URL для загрузки")
async def presign(
    payload: PresignRequest,
    _: User = Depends(get_current_user),
    s3: S3Adapter = Depends(_s3_dep),
) -> PresignResponse:
    url, fields, file_key, max_bytes = await service.presign(s3, payload)
    return PresignResponse(url=url, fields=fields, file_key=file_key, max_bytes=max_bytes)


@router.post("/confirm", response_model=FileResponse, summary="Подтвердить загрузку файла")
async def confirm(
    payload: ConfirmRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    rec = await service.confirm(db, user, payload)
    return _to_dto(rec)


@router.get("", response_model=list[FileResponse], summary="Файлы сущности")
async def list_files(
    entity_type: FileEntityType = Query(alias="entityType"),
    entity_id: uuid.UUID = Query(alias="entityId"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FileResponse]:
    rows = await service.list_for_entity(db, entity_type, entity_id)
    return [_to_dto(r) for r in rows]


@router.get(
    "/{file_id}/download",
    response_model=DownloadResponse,
    summary="Временный URL для скачивания",
)
async def get_download_url(
    file_id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    s3: S3Adapter = Depends(_s3_dep),
) -> DownloadResponse:
    file = await service.get_file(db, file_id)
    url = await service.download_url(s3, file)
    return DownloadResponse(url=url, expires_in=300)


@router.delete("/{file_id}", response_model=OkResponse, summary="Удалить файл")
async def delete_file(
    file_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    s3: S3Adapter = Depends(_s3_dep),
) -> OkResponse:
    await service.delete_file(db, s3, user, file_id)
    return OkResponse()


@router.post(
    "/render-pdf",
    summary="Собрать PDF из HTML",
)
async def render_pdf(
    payload: RenderPdfRequest,
    _: User = Depends(get_current_user),
) -> Response:
    try:
        pdf_bytes = await render_pdf_from_html(payload.html)
    except Exception as exc:
        raise ApiError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "pdf_render_failed",
            "Не удалось сформировать PDF на сервере",
            details=_pdf_error_details(exc),
        ) from exc

    safe_name = payload.filename.replace('"', "").replace("\n", "").replace("\r", "")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )
