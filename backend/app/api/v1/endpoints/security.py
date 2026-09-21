"""Эндпоинты безопасности: снимки веб-камеры при входе.

* POST /security/login-snapshot — вызывается фронтом сразу после успешного
  логина (нужен валидный access-токен). Принимает кадр как multipart-файл плюс
  статус захвата. Идемпотентности не требует: один вход — одна запись.
* GET  /security/login-snapshots — журнал снимков, только для admin.

Сбор ведётся с уведомлением сотрудников и на основании письменных согласий;
на форме входа показывается видимое превью камеры (прозрачность сбора).
"""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.db.session import get_db
from app.integrations.s3 import S3Adapter, get_s3_adapter
from app.modules.auth.dependencies import get_current_user, require_roles
from app.modules.login_snapshots import service
from app.modules.login_snapshots.models import SnapshotStatus
from app.modules.login_snapshots.schemas import (
    LoginSnapshotItem,
    LoginSnapshotResponse,
)
from app.modules.login_snapshots.service import (
    ALLOWED_IMAGE_MIME,
    MAX_SNAPSHOT_BYTES,
)
from app.modules.users.models import Role, User

router = APIRouter(prefix="/security", tags=["security"])


def _s3_dep() -> S3Adapter:
    return get_s3_adapter()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "0.0.0.0"


@router.post(
    "/login-snapshot",
    response_model=LoginSnapshotResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Сохранить снимок веб-камеры при входе",
)
async def create_login_snapshot(
    request: Request,
    status_: str = Form(..., alias="status"),
    image: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    s3: S3Adapter = Depends(_s3_dep),
) -> LoginSnapshotResponse:
    try:
        snap_status = SnapshotStatus(status_)
    except ValueError as e:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_status",
            "Недопустимый статус снимка",
        ) from e

    image_bytes: bytes | None = None
    content_type: str | None = None
    if snap_status == SnapshotStatus.ok and image is not None:
        content_type = image.content_type
        if content_type not in ALLOWED_IMAGE_MIME:
            raise ApiError(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "Разрешены только JPEG/PNG/WebP",
            )
        image_bytes = await image.read()
        if len(image_bytes) > MAX_SNAPSHOT_BYTES:
            raise ApiError(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "snapshot_too_large",
                "Снимок превышает допустимый размер",
            )

    entry = await service.record_snapshot(
        db,
        s3,
        user=user,
        status=snap_status,
        image_bytes=image_bytes,
        content_type=content_type,
        ip=_client_ip(request),
        user_agent=request.headers.get("User-Agent"),
    )
    return LoginSnapshotResponse(
        id=entry.id, status=entry.status, created_at=entry.created_at
    )


@router.get(
    "/login-snapshots",
    response_model=list[LoginSnapshotItem],
    summary="Журнал снимков входов (только admin)",
)
async def list_login_snapshots(
    user_id: uuid.UUID | None = Query(default=None, alias="userId"),
    date_from: date | None = Query(default=None, alias="dateFrom"),
    date_to: date | None = Query(default=None, alias="dateTo"),
    limit: int = Query(default=200, ge=1, le=500),
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
    s3: S3Adapter = Depends(_s3_dep),
) -> list[LoginSnapshotItem]:
    return await service.list_snapshots(
        db,
        s3,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )
