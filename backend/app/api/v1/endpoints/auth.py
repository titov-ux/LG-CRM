"""Auth-эндпоинты: login / refresh / logout / me.

Refresh-токен ставится в httpOnly Secure SameSite=Strict cookie. Дополнительно
дублируется в JSON `TokenResponse.refreshToken` для совместимости с типом во
фронте (поле остаётся в контракте, но прод-фронт пользуется только access).
"""
from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.redis import get_redis
from app.db.session import get_db
from app.modules.auth import service
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import (
    LoginRequest,
    OkResponse,
    RefreshResponse,
    TokenResponse,
)
from app.modules.users import service as users_service
from app.modules.users.models import User
from app.modules.users.schemas import (
    ActivateInviteRequest,
    InviteInfoResponse,
    UpdateProfileRequest,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"


def _redis_dep() -> Redis:
    return get_redis()


def _client_ip(request: Request) -> str:
    # Если за reverse-proxy (Nginx) — берём X-Forwarded-For; иначе client.host.
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "0.0.0.0"


def _set_refresh_cookie(response: Response, refresh: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        max_age=settings.refresh_token_ttl_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.env != "dev",
        samesite="strict",
        path=settings.api_v1_prefix + "/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(REFRESH_COOKIE, path=settings.api_v1_prefix + "/auth")


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="Войти по email/паролю",
)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> TokenResponse:
    _, access, refresh = await service.authenticate(
        db, redis, payload.email, payload.password, _client_ip(request)
    )
    _set_refresh_cookie(response, refresh)
    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=RefreshResponse, summary="Обновить access-токен")
async def refresh(
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> RefreshResponse:
    if not refresh_cookie:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "no_refresh", "Refresh-токен отсутствует")
    _, access, new_refresh = await service.rotate_refresh(db, redis, refresh_cookie)
    _set_refresh_cookie(response, new_refresh)
    return RefreshResponse(access_token=access)


@router.post("/logout", response_model=OkResponse, summary="Выйти")
async def logout(
    response: Response,
    redis: Redis = Depends(_redis_dep),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> OkResponse:
    await service.revoke(redis, refresh_cookie)
    _clear_refresh_cookie(response)
    return OkResponse()


@router.get("/me", response_model=UserResponse, summary="Профиль текущего пользователя")
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse, summary="Обновить профиль текущего пользователя")
async def update_me(
    payload: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    updated = await users_service.update_profile(db, user.id, payload)
    return UserResponse.model_validate(updated)


# ── Invite activation (публичные эндпоинты, без auth-гарда) ───────────────


@router.get(
    "/invite/{token}",
    response_model=InviteInfoResponse,
    summary="Информация по invite-токену",
)
async def invite_info(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> InviteInfoResponse:
    """Фронт зовёт этот эндпоинт при открытии страницы /invite/:token чтобы:
    - убедиться, что токен валиден и не истёк (иначе показать ошибку),
    - подтянуть email/имя для подсветки формы.
    """
    user, _ = await users_service.peek_invite(db, token)
    return InviteInfoResponse(email=user.email, full_name=user.full_name)


@router.post(
    "/invite/{token}/activate",
    response_model=TokenResponse,
    summary="Активировать аккаунт и установить пароль",
)
async def invite_activate(
    token: str,
    payload: ActivateInviteRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> TokenResponse:
    """Активируем аккаунт и сразу логиним пользователя — иначе ему пришлось бы
    после установки пароля ещё раз вводить email/пароль на форме логина, что
    бессмысленно ухудшает UX.
    """
    user = await users_service.activate_invite(db, token, new_password=payload.password)
    # Логинимся без проверки lockout — мы только что верифицировали владение
    # email через invite-ссылку, и rate-limit на /login тут не релевантен.
    from app.core.security import create_access_token, create_refresh_token
    from app.modules.auth import store as auth_store

    access = create_access_token(str(user.id), extra={"role": user.role.value})
    refresh = create_refresh_token(str(user.id))
    await auth_store.remember_refresh(redis, str(user.id), refresh)
    _set_refresh_cookie(response, refresh)
    # request оставлен в сигнатуре, чтобы дальше можно было залогировать IP активации.
    _ = request
    return TokenResponse(access_token=access, refresh_token=refresh)
