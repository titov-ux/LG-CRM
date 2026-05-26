"""DTO модуля files."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.files.models import FileEntityType, ScanStatus


class FileResponse(CamelModel):
    id: uuid.UUID
    # nullable: владелец сбрасывается в null при удалении пользователя.
    owner_user_id: uuid.UUID | None = None
    entity_type: FileEntityType
    entity_id: uuid.UUID
    file_key: str
    original_name: str
    mime: str
    size: int
    scan_status: ScanStatus
    scanned_at: datetime | None = None
    created_at: datetime


class PresignRequest(CamelModel):
    entity_type: FileEntityType
    entity_id: uuid.UUID
    original_name: str = Field(min_length=1, max_length=512)
    mime: str
    size: int = Field(ge=1)


class PresignResponse(CamelModel):
    url: str
    fields: dict[str, str]
    file_key: str
    max_bytes: int


class ConfirmRequest(CamelModel):
    file_key: str
    entity_type: FileEntityType
    entity_id: uuid.UUID
    original_name: str
    mime: str
    size: int


class DownloadResponse(CamelModel):
    url: str
    expires_in: int


class RenderPdfRequest(CamelModel):
    html: str = Field(min_length=1, max_length=2_000_000)
    filename: str = Field(min_length=1, max_length=255)
