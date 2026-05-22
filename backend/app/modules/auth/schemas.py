"""DTO модуля auth."""
from __future__ import annotations

from pydantic import EmailStr, Field

from app.core.schemas import CamelModel


class LoginRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1)


class TokenResponse(CamelModel):
    """Ответ /auth/login.

    `refreshToken` дублируется в теле для совместимости с фронтовым типом
    `TokenResponse` (см. `frontend/src/api/types.ts`). На реальном проде фронт
    использует только `accessToken`, а refresh ставится сервером в httpOnly
    cookie — но и дублировать его в JSON безопасно при HTTPS + SameSite=Strict.
    """

    access_token: str
    refresh_token: str


class RefreshResponse(CamelModel):
    access_token: str


class OkResponse(CamelModel):
    ok: bool = True
