"""Сервис documents."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import status
from sqlalchemy import Select, String, cast, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.documents.models import (
    Document,
    DocumentComment,
    DocumentFavorite,
    DocumentKind,
    DocumentSectionId,
    DocumentVersion,
)
from app.modules.documents.schemas import (
    BulkMoveDocumentsRequest,
    CreateDocumentCommentRequest,
    CreateDocumentRequest,
    CreateDocumentVersionRequest,
    MoveDocumentRequest,
    UpdateDocumentRequest,
)
from app.modules.files.models import File
from app.modules.users.models import Role, User


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_can_write(user: User, doc: Document) -> None:
    if user.role == Role.admin:
        return
    if doc.owner_user_id != user.id:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Недостаточно прав")


async def _ensure_owner_exists(db: AsyncSession, owner_user_id: uuid.UUID) -> None:
    if await db.get(User, owner_user_id) is None:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "owner_not_found", "Владелец не найден")


async def _ensure_file_exists(db: AsyncSession, file_id: uuid.UUID) -> None:
    if await db.get(File, file_id) is None:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "file_not_found", "Файл не найден")


async def _validate_parent(
    db: AsyncSession,
    *,
    section: DocumentSectionId,
    parent_id: uuid.UUID | None,
    moving_doc_id: uuid.UUID | None = None,
) -> None:
    if parent_id is None:
        return
    parent = await db.get(Document, parent_id)
    if parent is None:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_parent", "Родительская папка не найдена")
    if parent.kind != DocumentKind.folder:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "parent_not_folder", "Родитель не является папкой")
    if parent.section != section:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_parent",
            "Родительская папка должна быть в том же разделе",
        )
    if moving_doc_id is None:
        return
    if parent_id == moving_doc_id:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "cycle_detected", "Нельзя переместить папку в саму себя")

    probe = parent
    while probe.parent_id is not None:
        if probe.parent_id == moving_doc_id:
            raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "cycle_detected", "Нельзя переместить папку в саму себя")
        next_probe = await db.get(Document, probe.parent_id)
        if next_probe is None:
            break
        probe = next_probe


async def get_document_or_404(db: AsyncSession, document_id: uuid.UUID) -> Document:
    doc = await db.get(Document, document_id)
    if doc is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Документ не найден")
    return doc


async def get_document_view(db: AsyncSession, user: User, document_id: uuid.UUID) -> dict:
    favorite_exists = exists(
        select(1).where(
            DocumentFavorite.document_id == Document.id,
            DocumentFavorite.user_id == user.id,
        )
    )
    versions_count = (
        select(func.count(DocumentVersion.id))
        .where(DocumentVersion.document_id == Document.id)
        .scalar_subquery()
    )
    comments_count = (
        select(func.count(DocumentComment.id))
        .where(DocumentComment.document_id == Document.id)
        .scalar_subquery()
    )
    row = (
        await db.execute(
            select(
                Document,
                User.full_name.label("owner_name"),
                File.original_name.label("file_name"),
                File.mime.label("file_mime"),
                File.size.label("file_size"),
                versions_count.label("versions_count"),
                comments_count.label("comments_count"),
                favorite_exists.label("is_favorite"),
            )
            .outerjoin(User, User.id == Document.owner_user_id)
            .outerjoin(File, File.id == Document.file_id)
            .where(Document.id == document_id)
        )
    ).one_or_none()
    if row is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Документ не найден")
    doc: Document = row.Document
    file_meta = None
    if row.file_name and row.file_mime and row.file_size is not None:
        file_meta = {
            "file_name": row.file_name,
            "mime": row.file_mime,
            "size": int(row.file_size),
        }
    return {
        "id": doc.id,
        "title": doc.title,
        "emoji": doc.emoji,
        "kind": doc.kind,
        "section": doc.section,
        "parent_id": doc.parent_id,
        "description": doc.description,
        "tags": list(doc.tags or []),
        "owner_user_id": doc.owner_user_id,
        "owner_name": row.owner_name,
        "file_id": doc.file_id,
        "file_meta": file_meta,
        "body": doc.body,
        "versions_count": int(row.versions_count or 0),
        "comments_count": int(row.comments_count or 0),
        "is_favorite": bool(row.is_favorite),
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
    }


async def list_documents(
    db: AsyncSession,
    user: User,
    *,
    page: int,
    page_size: int,
    section: DocumentSectionId | None,
    parent_id: uuid.UUID | None,
    kind: DocumentKind | None,
    tag: str | None,
    favorite: bool | None,
    q: str | None,
    owner_id: uuid.UUID | None,
    sort_by: str,
    sort_dir: str,
) -> tuple[list[dict], int]:
    favorite_exists = exists(
        select(1).where(
            DocumentFavorite.document_id == Document.id,
            DocumentFavorite.user_id == user.id,
        )
    )
    versions_count = (
        select(func.count(DocumentVersion.id))
        .where(DocumentVersion.document_id == Document.id)
        .scalar_subquery()
    )
    comments_count = (
        select(func.count(DocumentComment.id))
        .where(DocumentComment.document_id == Document.id)
        .scalar_subquery()
    )

    where = []
    if section is not None:
        where.append(Document.section == section)
    if parent_id is not None:
        where.append(Document.parent_id == parent_id)
    if kind is not None:
        where.append(Document.kind == kind)
    if tag:
        where.append(Document.tags.any(tag))
    if owner_id is not None:
        where.append(Document.owner_user_id == owner_id)
    if favorite is True:
        where.append(favorite_exists)
    elif favorite is False:
        where.append(~favorite_exists)
    if q:
        q_like = f"%{q.strip()}%"
        where.append(
            or_(
                Document.title.ilike(q_like),
                Document.description.ilike(q_like),
                User.full_name.ilike(q_like),
                cast(Document.tags, String).ilike(q_like),
            )
        )

    sort_columns: dict[str, object] = {
        "updated": Document.updated_at,
        "oldest": Document.updated_at,
        "title": Document.title,
        "owner": User.full_name,
        "kind": Document.kind,
    }
    sort_col = sort_columns.get(sort_by, Document.updated_at)
    order_expr = sort_col.asc() if sort_dir == "asc" else sort_col.desc()
    if sort_by == "oldest":
        order_expr = Document.updated_at.asc()

    base_select: Select = (
        select(
            Document,
            User.full_name.label("owner_name"),
            File.original_name.label("file_name"),
            File.mime.label("file_mime"),
            File.size.label("file_size"),
            versions_count.label("versions_count"),
            comments_count.label("comments_count"),
            favorite_exists.label("is_favorite"),
        )
        .outerjoin(User, User.id == Document.owner_user_id)
        .outerjoin(File, File.id == Document.file_id)
    )
    if where:
        base_select = base_select.where(*where)
    base_select = base_select.order_by(order_expr, Document.created_at.desc())
    base_select = base_select.offset((page - 1) * page_size).limit(page_size)

    count_query: Select = select(func.count(Document.id)).outerjoin(User, User.id == Document.owner_user_id)
    if where:
        count_query = count_query.where(*where)

    rows = (await db.execute(base_select)).all()
    total = int((await db.execute(count_query)).scalar_one())

    items: list[dict] = []
    for row in rows:
        doc: Document = row.Document
        file_meta = None
        if row.file_name and row.file_mime and row.file_size is not None:
            file_meta = {
                "file_name": row.file_name,
                "mime": row.file_mime,
                "size": int(row.file_size),
            }
        items.append(
            {
                "id": doc.id,
                "title": doc.title,
                "emoji": doc.emoji,
                "kind": doc.kind,
                "section": doc.section,
                "parent_id": doc.parent_id,
                "description": doc.description,
                "tags": list(doc.tags or []),
                "owner_user_id": doc.owner_user_id,
                "owner_name": row.owner_name,
                "file_id": doc.file_id,
                "file_meta": file_meta,
                "body": doc.body,
                "versions_count": int(row.versions_count or 0),
                "comments_count": int(row.comments_count or 0),
                "is_favorite": bool(row.is_favorite),
                "created_at": doc.created_at,
                "updated_at": doc.updated_at,
            }
        )
    return items, total


async def create_document(db: AsyncSession, user: User, payload: CreateDocumentRequest) -> Document:
    title = payload.title.strip()
    if not title:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_title", "Название не может быть пустым")
    owner_user_id = payload.owner_user_id or user.id
    if owner_user_id != user.id and user.role != Role.admin:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нельзя назначить другого владельца")
    await _ensure_owner_exists(db, owner_user_id)
    if payload.file_id is not None:
        await _ensure_file_exists(db, payload.file_id)
    await _validate_parent(db, section=payload.section, parent_id=payload.parent_id)
    if payload.kind == DocumentKind.note and payload.file_id is not None:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_note_file", "Для заметки fileId не используется")

    doc = Document(
        title=title,
        emoji=payload.emoji,
        kind=payload.kind,
        section=payload.section,
        parent_id=payload.parent_id,
        description=payload.description,
        tags=list(payload.tags or []),
        owner_user_id=owner_user_id,
        file_id=payload.file_id,
        body=payload.body if payload.kind == DocumentKind.note else None,
        updated_at=_now(),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


async def update_document(
    db: AsyncSession,
    user: User,
    document_id: uuid.UUID,
    payload: UpdateDocumentRequest,
) -> Document:
    doc = await get_document_or_404(db, document_id)
    _ensure_can_write(user, doc)
    provided = payload.model_fields_set
    if "owner_user_id" in provided and payload.owner_user_id is not None:
        if user.role != Role.admin:
            raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нельзя менять владельца")
        await _ensure_owner_exists(db, payload.owner_user_id)
        doc.owner_user_id = payload.owner_user_id
    if "title" in provided and payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_title", "Название не может быть пустым")
        doc.title = title
    if "emoji" in provided and payload.emoji is not None:
        doc.emoji = payload.emoji
    if "description" in provided:
        doc.description = payload.description
    if "tags" in provided and payload.tags is not None:
        doc.tags = list(payload.tags)
    if "file_id" in provided:
        if payload.file_id is not None:
            if doc.kind == DocumentKind.note:
                raise ApiError(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "invalid_note_file",
                    "Для заметки fileId не используется",
                )
            await _ensure_file_exists(db, payload.file_id)
        doc.file_id = payload.file_id
    if "body" in provided and doc.kind == DocumentKind.note:
        doc.body = payload.body
    doc.updated_at = _now()
    await db.commit()
    await db.refresh(doc)
    return doc


async def move_document(
    db: AsyncSession, user: User, document_id: uuid.UUID, payload: MoveDocumentRequest
) -> Document:
    doc = await get_document_or_404(db, document_id)
    _ensure_can_write(user, doc)
    await _validate_parent(
        db,
        section=payload.section,
        parent_id=payload.parent_id,
        moving_doc_id=doc.id,
    )
    doc.section = payload.section
    doc.parent_id = payload.parent_id
    doc.updated_at = _now()
    await db.commit()
    await db.refresh(doc)
    return doc


async def bulk_move_documents(
    db: AsyncSession,
    user: User,
    payload: BulkMoveDocumentsRequest,
) -> int:
    moved = 0
    for document_id in payload.ids:
        try:
            await move_document(
                db,
                user,
                document_id,
                MoveDocumentRequest(section=payload.section, parent_id=payload.parent_id),
            )
            moved += 1
        except ApiError:
            continue
    return moved


async def _collect_subtree_ids(db: AsyncSession, root_id: uuid.UUID) -> set[uuid.UUID]:
    all_ids: set[uuid.UUID] = {root_id}
    frontier: set[uuid.UUID] = {root_id}
    while frontier:
        child_rows = await db.execute(select(Document.id).where(Document.parent_id.in_(frontier)))
        children = set(child_rows.scalars().all())
        children = children - all_ids
        if not children:
            break
        all_ids.update(children)
        frontier = children
    return all_ids


async def delete_document(db: AsyncSession, user: User, document_id: uuid.UUID) -> int:
    doc = await get_document_or_404(db, document_id)
    _ensure_can_write(user, doc)
    ids = await _collect_subtree_ids(db, doc.id)
    await db.execute(delete(DocumentFavorite).where(DocumentFavorite.document_id.in_(ids)))
    await db.execute(delete(DocumentVersion).where(DocumentVersion.document_id.in_(ids)))
    await db.execute(delete(DocumentComment).where(DocumentComment.document_id.in_(ids)))
    result = await db.execute(delete(Document).where(Document.id.in_(ids)))
    await db.commit()
    return int(result.rowcount or 0)


async def bulk_delete_documents(db: AsyncSession, user: User, ids: list[uuid.UUID]) -> int:
    deleted = 0
    visited: set[uuid.UUID] = set()
    for document_id in ids:
        if document_id in visited:
            continue
        try:
            root = await get_document_or_404(db, document_id)
            _ensure_can_write(user, root)
            subtree = await _collect_subtree_ids(db, root.id)
            visited.update(subtree)
            await db.execute(delete(DocumentFavorite).where(DocumentFavorite.document_id.in_(subtree)))
            await db.execute(delete(DocumentVersion).where(DocumentVersion.document_id.in_(subtree)))
            await db.execute(delete(DocumentComment).where(DocumentComment.document_id.in_(subtree)))
            result = await db.execute(delete(Document).where(Document.id.in_(subtree)))
            deleted += int(result.rowcount or 0)
        except ApiError:
            continue
    await db.commit()
    return deleted


async def duplicate_document(db: AsyncSession, user: User, document_id: uuid.UUID) -> Document:
    doc = await get_document_or_404(db, document_id)
    clone = Document(
        title=f"{doc.title} — копия",
        emoji=doc.emoji,
        kind=doc.kind,
        section=doc.section,
        parent_id=doc.parent_id,
        description=doc.description,
        tags=list(doc.tags or []),
        owner_user_id=user.id,
        file_id=doc.file_id,
        body=doc.body,
        updated_at=_now(),
    )
    db.add(clone)
    await db.commit()
    await db.refresh(clone)
    return clone


async def set_favorite(db: AsyncSession, user: User, document_id: uuid.UUID, favorite: bool) -> None:
    await get_document_or_404(db, document_id)
    existing = await db.execute(
        select(DocumentFavorite).where(
            DocumentFavorite.document_id == document_id,
            DocumentFavorite.user_id == user.id,
        )
    )
    row = existing.scalar_one_or_none()
    if favorite and row is None:
        db.add(DocumentFavorite(document_id=document_id, user_id=user.id))
    if not favorite and row is not None:
        await db.delete(row)
    await db.commit()


async def list_versions(db: AsyncSession, document_id: uuid.UUID) -> list[tuple[DocumentVersion, str | None]]:
    await get_document_or_404(db, document_id)
    rows = await db.execute(
        select(DocumentVersion, User.full_name)
        .outerjoin(User, User.id == DocumentVersion.author_user_id)
        .where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.created_at.desc())
    )
    return list(rows.all())


async def add_version(
    db: AsyncSession,
    user: User,
    document_id: uuid.UUID,
    payload: CreateDocumentVersionRequest,
) -> tuple[DocumentVersion, str | None]:
    doc = await get_document_or_404(db, document_id)
    label = payload.label.strip()
    if not label:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_label", "Метка версии не может быть пустой")
    if payload.file_id is not None:
        await _ensure_file_exists(db, payload.file_id)
    version = DocumentVersion(
        document_id=document_id,
        label=label,
        note=payload.note,
        author_user_id=user.id,
        file_id=payload.file_id,
    )
    db.add(version)
    doc.updated_at = _now()
    await db.commit()
    await db.refresh(version)
    return version, user.full_name


async def list_comments(db: AsyncSession, document_id: uuid.UUID) -> list[tuple[DocumentComment, str | None]]:
    await get_document_or_404(db, document_id)
    rows = await db.execute(
        select(DocumentComment, User.full_name)
        .outerjoin(User, User.id == DocumentComment.author_user_id)
        .where(DocumentComment.document_id == document_id)
        .order_by(DocumentComment.created_at.asc())
    )
    return list(rows.all())


async def add_comment(
    db: AsyncSession,
    user: User,
    document_id: uuid.UUID,
    payload: CreateDocumentCommentRequest,
) -> tuple[DocumentComment, str | None]:
    doc = await get_document_or_404(db, document_id)
    text = payload.text.strip()
    if not text:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_text", "Комментарий не может быть пустым")
    comment = DocumentComment(
        document_id=document_id,
        text_=text,
        author_user_id=user.id,
    )
    db.add(comment)
    doc.updated_at = _now()
    await db.commit()
    await db.refresh(comment)
    return comment, user.full_name

