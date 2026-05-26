"""DTO модуля documents."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.documents.models import DocumentKind, DocumentSectionId


class DocumentFileMeta(CamelModel):
    file_name: str
    mime: str
    size: int


class DocumentResponse(CamelModel):
    id: uuid.UUID
    title: str
    emoji: str
    kind: DocumentKind
    section: DocumentSectionId
    parent_id: uuid.UUID | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    owner_user_id: uuid.UUID
    owner_name: str | None = None
    file_id: uuid.UUID | None = None
    file_meta: DocumentFileMeta | None = None
    body: str | None = None
    versions_count: int = 0
    comments_count: int = 0
    is_favorite: bool = False
    created_at: datetime
    updated_at: datetime


class DocumentPage(CamelModel):
    items: list[DocumentResponse]
    total: int
    page: int
    page_size: int


class CreateDocumentRequest(CamelModel):
    title: str = Field(min_length=1)
    emoji: str = Field(min_length=1, max_length=16)
    kind: DocumentKind
    section: DocumentSectionId
    parent_id: uuid.UUID | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    owner_user_id: uuid.UUID | None = None
    file_id: uuid.UUID | None = None
    body: str | None = None


class UpdateDocumentRequest(CamelModel):
    title: str | None = Field(default=None, min_length=1)
    emoji: str | None = Field(default=None, min_length=1, max_length=16)
    description: str | None = None
    tags: list[str] | None = None
    owner_user_id: uuid.UUID | None = None
    body: str | None = None


class MoveDocumentRequest(CamelModel):
    section: DocumentSectionId
    parent_id: uuid.UUID | None = None


class BulkMoveDocumentsRequest(CamelModel):
    ids: list[uuid.UUID] = Field(min_length=1)
    section: DocumentSectionId
    parent_id: uuid.UUID | None = None


class BulkDeleteDocumentsRequest(CamelModel):
    ids: list[uuid.UUID] = Field(min_length=1)


class SetFavoriteRequest(CamelModel):
    favorite: bool


class CreateDocumentVersionRequest(CamelModel):
    label: str = Field(min_length=1, max_length=128)
    note: str | None = None
    file_id: uuid.UUID | None = None


class DocumentVersionResponse(CamelModel):
    id: uuid.UUID
    document_id: uuid.UUID
    label: str
    note: str | None = None
    author_user_id: uuid.UUID
    author_name: str | None = None
    file_id: uuid.UUID | None = None
    created_at: datetime


class CreateDocumentCommentRequest(CamelModel):
    text: str = Field(min_length=1)


class DocumentCommentResponse(CamelModel):
    id: uuid.UUID
    document_id: uuid.UUID
    text: str
    author_user_id: uuid.UUID
    author_name: str | None = None
    created_at: datetime

