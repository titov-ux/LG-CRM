"""Сервис comments.

Право редактировать/удалять — у автора и admin (см. permissions).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.comments.models import Comment, CommentEntityType
from app.modules.comments.schemas import CreateCommentRequest, UpdateCommentRequest
from app.modules.users.models import Role, User


async def list_for_entity(
    db: AsyncSession, entity_type: CommentEntityType, entity_id: uuid.UUID
) -> list[Comment]:
    res = await db.execute(
        select(Comment)
        .where(Comment.entity_type == entity_type, Comment.entity_id == entity_id)
        .order_by(Comment.created_at)
    )
    return list(res.scalars().all())


async def create_comment(
    db: AsyncSession, user: User, payload: CreateCommentRequest
) -> Comment:
    comment = Comment(
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        author_id=user.id,
        parent_id=payload.parent_id,
        text_=payload.text,
        mentions=list(payload.mentions),
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


def _ensure_can_edit(user: User, comment: Comment) -> None:
    if user.role == Role.admin:
        return
    if comment.author_id != user.id:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Редактировать может только автор")


async def update_comment(
    db: AsyncSession, user: User, comment_id: uuid.UUID, payload: UpdateCommentRequest
) -> Comment:
    comment = await db.get(Comment, comment_id)
    if comment is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Комментарий не найден")
    _ensure_can_edit(user, comment)
    comment.text_ = payload.text
    if payload.mentions is not None:
        comment.mentions = list(payload.mentions)
    comment.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(comment)
    return comment


async def delete_comment(db: AsyncSession, user: User, comment_id: uuid.UUID) -> None:
    comment = await db.get(Comment, comment_id)
    if comment is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Комментарий не найден")
    _ensure_can_edit(user, comment)
    await db.delete(comment)
    await db.commit()
