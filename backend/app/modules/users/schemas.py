"""DTO модуля users (соответствуют схеме `User` в openapi.yaml)."""
from __future__ import annotations

import uuid

from pydantic import EmailStr, Field

from app.core.schemas import CamelModel
from app.modules.users.models import Role


class UserResponse(CamelModel):
    id: uuid.UUID
    email: EmailStr
    telegram: str | None = None
    full_name: str
    role: Role
    initials: str
    color: str
    is_active: bool


class CreateUserRequest(CamelModel):
    email: EmailStr
    telegram: str | None = None
    full_name: str
    role: Role
    password: str | None = Field(default=None, min_length=8)
    is_active: bool = True


class UpdateUserRequest(CamelModel):
    email: EmailStr | None = None
    telegram: str | None = None
    full_name: str | None = None
    role: Role | None = None
    is_active: bool | None = None


class UpdateProfileRequest(CamelModel):
    email: EmailStr | None = None
    telegram: str | None = None
    full_name: str | None = None
