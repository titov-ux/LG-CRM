"""Эндпоинты /documents."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.documents import service
from app.modules.documents.models import Document, DocumentComment, DocumentKind, DocumentSectionId, DocumentVersion
from app.modules.documents.schemas import (
    BulkDeleteDocumentsRequest,
    BulkMoveDocumentsRequest,
    CreateDocumentCommentRequest,
    CreateDocumentRequest,
    CreateDocumentVersionRequest,
    DocumentCommentResponse,
    DocumentFileMeta,
    DocumentPage,
    DocumentResponse,
    DocumentVersionResponse,
    MoveDocumentRequest,
    SetFavoriteRequest,
    UpdateDocumentRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/documents", tags=["documents"])


def _to_document_dto(
    doc: Document,
    *,
    owner_name: str | None = None,
    file_name: str | None = None,
    file_mime: str | None = None,
    file_size: int | None = None,
    versions_count: int = 0,
    comments_count: int = 0,
    is_favorite: bool = False,
) -> DocumentResponse:
    file_meta = None
    if file_name and file_mime and file_size is not None:
        file_meta = DocumentFileMeta(file_name=file_name, mime=file_mime, size=file_size)
    return DocumentResponse(
        id=doc.id,
        title=doc.title,
        emoji=doc.emoji,
        kind=doc.kind,
        section=doc.section,
        parent_id=doc.parent_id,
        description=doc.description,
        tags=list(doc.tags or []),
        owner_user_id=doc.owner_user_id,
        owner_name=owner_name,
        file_id=doc.file_id,
        file_meta=file_meta,
        body=doc.body,
        versions_count=versions_count,
        comments_count=comments_count,
        is_favorite=is_favorite,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


def _to_version_dto(v: DocumentVersion, author_name: str | None) -> DocumentVersionResponse:
    return DocumentVersionResponse(
        id=v.id,
        document_id=v.document_id,
        label=v.label,
        note=v.note,
        author_user_id=v.author_user_id,
        author_name=author_name,
        file_id=v.file_id,
        created_at=v.created_at,
    )


def _to_comment_dto(c: DocumentComment, author_name: str | None) -> DocumentCommentResponse:
    return DocumentCommentResponse(
        id=c.id,
        document_id=c.document_id,
        text=c.text_,
        author_user_id=c.author_user_id,
        author_name=author_name,
        created_at=c.created_at,
    )


@router.get("", response_model=DocumentPage, summary="Список документов с фильтрами")
async def list_documents(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500, alias="pageSize"),
    section: DocumentSectionId | None = Query(default=None),
    parent_id: uuid.UUID | None = Query(default=None, alias="parentId"),
    kind: DocumentKind | None = Query(default=None),
    tag: str | None = Query(default=None),
    favorite: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    owner_id: uuid.UUID | None = Query(default=None, alias="ownerId"),
    sort_by: str = Query(default="updated", alias="sortBy"),
    sort_dir: str = Query(default="desc", alias="sortDir"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentPage:
    items, total = await service.list_documents(
        db,
        user,
        page=page,
        page_size=page_size,
        section=section,
        parent_id=parent_id,
        kind=kind,
        tag=tag,
        favorite=favorite,
        q=q,
        owner_id=owner_id,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return DocumentPage(items=[DocumentResponse.model_validate(x) for x in items], total=total, page=page, page_size=page_size)


@router.post(
    "",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать документ или папку",
)
async def create_document(
    payload: CreateDocumentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    doc = await service.create_document(db, user, payload)
    return _to_document_dto(doc)


@router.get("/{id}", response_model=DocumentResponse, summary="Получить документ")
async def get_document(
    id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    row = await service.get_document_view(db, user, id)
    return DocumentResponse.model_validate(row)


@router.patch("/{id}", response_model=DocumentResponse, summary="Обновить метаданные")
async def update_document(
    id: uuid.UUID,
    payload: UpdateDocumentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    doc = await service.update_document(db, user, id, payload)
    return _to_document_dto(doc)


@router.delete("/{id}", response_model=OkResponse, summary="Удалить документ или папку")
async def delete_document(
    id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_document(db, user, id)
    return OkResponse()


@router.post("/{id}/move", response_model=DocumentResponse, summary="Переместить документ в другой раздел/папку")
async def move_document(
    id: uuid.UUID,
    payload: MoveDocumentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    doc = await service.move_document(db, user, id, payload)
    return _to_document_dto(doc)


@router.post("/bulk-move", summary="Массовое перемещение")
async def bulk_move(
    payload: BulkMoveDocumentsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    moved = await service.bulk_move_documents(db, user, payload)
    return {"moved": moved}


@router.post("/bulk-delete", summary="Массовое удаление")
async def bulk_delete(
    payload: BulkDeleteDocumentsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    deleted = await service.bulk_delete_documents(db, user, payload.ids)
    return {"deleted": deleted}


@router.post(
    "/{id}/duplicate",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Дублировать документ",
)
async def duplicate_document(
    id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    doc = await service.duplicate_document(db, user, id)
    return _to_document_dto(doc)


@router.put("/{id}/favorite", response_model=OkResponse, summary="Добавить/убрать из избранного")
async def set_favorite(
    id: uuid.UUID,
    payload: SetFavoriteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.set_favorite(db, user, id, payload.favorite)
    return OkResponse()


@router.get("/{id}/versions", response_model=list[DocumentVersionResponse], summary="История версий")
async def list_versions(
    id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentVersionResponse]:
    rows = await service.list_versions(db, id)
    return [_to_version_dto(v, author_name) for v, author_name in rows]


@router.post(
    "/{id}/versions",
    response_model=DocumentVersionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Сохранить новую версию",
)
async def add_version(
    id: uuid.UUID,
    payload: CreateDocumentVersionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentVersionResponse:
    version, author_name = await service.add_version(db, user, id, payload)
    return _to_version_dto(version, author_name)


@router.get("/{id}/comments", response_model=list[DocumentCommentResponse], summary="Комментарии к документу")
async def list_comments(
    id: uuid.UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentCommentResponse]:
    rows = await service.list_comments(db, id)
    return [_to_comment_dto(c, author_name) for c, author_name in rows]


@router.post(
    "/{id}/comments",
    response_model=DocumentCommentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить комментарий",
)
async def add_comment(
    id: uuid.UUID,
    payload: CreateDocumentCommentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentCommentResponse:
    comment, author_name = await service.add_comment(db, user, id, payload)
    return _to_comment_dto(comment, author_name)

