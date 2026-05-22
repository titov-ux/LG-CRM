"""DTO модуля comments."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.comments.models import CommentEntityType


class CommentResponse(CamelModel):
    id: uuid.UUID
    entity_type: CommentEntityType
    entity_id: uuid.UUID
    author_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    text: str
    mentions: list[uuid.UUID] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime | None = None


class CreateCommentRequest(CamelModel):
    entity_type: CommentEntityType
    entity_id: uuid.UUID
    text: str = Field(min_length=1)
    parent_id: uuid.UUID | None = None
    mentions: list[uuid.UUID] = Field(default_factory=list)


class UpdateCommentRequest(CamelModel):
    text: str = Field(min_length=1)
    mentions: list[uuid.UUID] | None = None
