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
    # Пароль необязателен: если пуст — заведём пользователя через invite-flow
    # (письмо со ссылкой, на которой он сам задаст пароль). См. service.create_user.
    password: str | None = Field(default=None, min_length=8)
    # По умолчанию True — но если password не задан, invite-flow всё равно
    # принудительно выставит is_active=False до активации.
    is_active: bool = True


class CreateUserResponse(CamelModel):
    """Ответ POST /users.

    `inviteUrl` появляется только в случае invite-flow и только если SMTP не
    настроен или отправка письма не удалась — в этом случае админ может
    скопировать ссылку и переслать вручную. На проде с рабочим SMTP — `null`.
    """

    user: UserResponse
    invite_url: str | None = None


class InviteResendResponse(CamelModel):
    user: UserResponse
    invite_url: str | None = None
    email_sent: bool


class UpdateUserRequest(CamelModel):
    email: EmailStr | None = None
    telegram: str | None = None
    full_name: str | None = None
    role: Role | None = None
    is_active: bool | None = None


class SetPasswordRequest(CamelModel):
    """Админский сброс пароля другому пользователю (POST /users/{id}/password)."""

    # Границы синхронны с ActivateInviteRequest и zod-схемой на фронте.
    password: str = Field(min_length=8, max_length=128)


class UpdateProfileRequest(CamelModel):
    email: EmailStr | None = None
    telegram: str | None = None
    full_name: str | None = None


# ── Invite activation (используется /auth/invite/{token}) ──────────────────


class InviteInfoResponse(CamelModel):
    """Что фронт показывает на странице установки пароля до сабмита."""

    email: EmailStr
    full_name: str


class ActivateInviteRequest(CamelModel):
    # Минимум 8 символов — синхронно с zod-схемой на фронте.
    password: str = Field(min_length=8, max_length=128)
