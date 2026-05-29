"""DTO модуля integrations."""
from __future__ import annotations

import uuid

from pydantic import Field

from app.core.schemas import CamelModel


class HhStatusResponse(CamelModel):
    configured: bool
    connected: bool
    account_label: str | None = None
    expires_at: str | None = None


class HhAuthorizeUrlResponse(CamelModel):
    authorize_url: str
    state: str


class HhExchangeCodeRequest(CamelModel):
    code: str = Field(min_length=1)
    state: str = Field(min_length=1)


class HhImportResumeRequest(CamelModel):
    """Принимаем url ИЛИ id — сервер разберётся."""

    url: str = Field(min_length=1, description="URL резюме hh.ru или его hex-id")
    vacancy_id: uuid.UUID | None = None
    recruiter_id: uuid.UUID | None = None
