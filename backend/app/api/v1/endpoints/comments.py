"""Эндпоинты /comments."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.comments import service
from app.modules.comments.models import Comment, CommentEntityType
from app.modules.comments.schemas import (
    CommentResponse,
    CreateCommentRequest,
    UpdateCommentRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/comments", tags=["comments"])


def _to_dto(c: Comment) -> CommentResponse:
    return CommentResponse(
        id=c.id,
        entity_type=c.entity_type,
        entity_id=c.entity_id,
        author_id=c.author_id,
        parent_id=c.parent_id,
        text=c.text_,
        mentions=list(c.mentions or []),
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.get("", response_model=list[CommentResponse], summary="Комментарии к сущности")
async def list_comments(
    entity_type: CommentEntityType = Query(alias="entityType"),
    entity_id: uuid.UUID = Query(alias="entityId"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CommentResponse]:
    rows = await service.list_for_entity(db, entity_type, entity_id)
    return [_to_dto(c) for c in rows]


@router.post(
    "",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать комментарий",
)
async def create_comment(
    payload: CreateCommentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommentResponse:
    comment = await service.create_comment(db, user, payload)
    return _to_dto(comment)


@router.patch("/{comment_id}", response_model=CommentResponse, summary="Редактировать комментарий")
async def update_comment(
    comment_id: uuid.UUID,
    payload: UpdateCommentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommentResponse:
    comment = await service.update_comment(db, user, comment_id, payload)
    return _to_dto(comment)


@router.delete("/{comment_id}", response_model=OkResponse, summary="Удалить комментарий")
async def delete_comment(
    comment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_comment(db, user, comment_id)
    return OkResponse()
