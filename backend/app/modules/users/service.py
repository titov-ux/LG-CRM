"""Бизнес-логика модуля users.

Тонкий слой над SQLAlchemy — без HTTP-специфики, чтобы можно было дёргать из
seed-скриптов и фоновых задач.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import hash_password
from app.integrations.email import render_invite_email, send_email
from app.modules.users.invites import (
    INVITE_TTL_DAYS,
    PasswordInvite,
    generate_raw_token,
    hash_token,
)
from app.modules.users.models import User, compute_initials
from app.modules.users.schemas import CreateUserRequest, UpdateProfileRequest, UpdateUserRequest

UTC = timezone.utc
log = logging.getLogger(__name__)

# Палитра «аватарок» — соответствует тому, что фронт рисует в UI.
_DEFAULT_COLORS = [
    "#0ea5e9",  # sky-500
    "#22c55e",  # green-500
    "#a855f7",  # purple-500
    "#f97316",  # orange-500
    "#ef4444",  # red-500
    "#14b8a6",  # teal-500
    "#eab308",  # yellow-500
]


def _pick_color(seed: str) -> str:
    idx = sum(ord(c) for c in seed) % len(_DEFAULT_COLORS)
    return _DEFAULT_COLORS[idx]


def _ttl_days() -> int:
    """TTL invite в днях: из конфига, fallback на константу модуля invites."""
    settings = get_settings()
    return getattr(settings, "invite_ttl_days", INVITE_TTL_DAYS) or INVITE_TTL_DAYS


def _build_invite_url(raw_token: str) -> str:
    settings = get_settings()
    base = (settings.app_base_url or "").rstrip("/")
    return f"{base}/invite/{raw_token}"


async def list_users(db: AsyncSession) -> list[User]:
    res = await db.execute(select(User).order_by(User.full_name))
    return list(res.scalars().all())


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Пользователь не найден")
    return user


async def _create_invite(db: AsyncSession, *, user_id: uuid.UUID) -> str:
    """Создать invite-токен для пользователя. Возвращает RAW токен (для письма)."""
    raw = generate_raw_token()
    invite = PasswordInvite(
        user_id=user_id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(UTC) + timedelta(days=_ttl_days()),
    )
    db.add(invite)
    return raw


async def _send_invite_email(*, to: str, full_name: str, raw_token: str) -> bool:
    """Отправить письмо с invite-ссылкой. Возвращает True, если SMTP реально отработал."""
    invite_url = _build_invite_url(raw_token)
    subject, text, html, inline_images = render_invite_email(
        full_name=full_name or to,
        invite_url=invite_url,
        ttl_days=_ttl_days(),
    )
    return await send_email(
        to=to,
        subject=subject,
        text_body=text,
        html_body=html,
        inline_images=inline_images,
    )


async def create_user(db: AsyncSession, payload: CreateUserRequest) -> tuple[User, str | None]:
    """Создать пользователя.

    Сценарии:
    - Если в payload передан `password` — создаём «классически», is_active как
      указано, без приглашения. Это нужно для seed-скриптов и dev-flow.
    - Если пароль не передан — это invite-flow:
        * password_hash = заглушка (случайные 64 символа hex), войти ею нельзя,
        * is_active = False (независимо от того, что просили),
        * создаём `PasswordInvite` и шлём письмо.

    Возвращает `(user, raw_token_or_None)`. raw_token не пуст только в invite-
    режиме и только когда отправка email не удалась — тогда админ увидит ссылку
    в ответе и сможет переслать её сам.
    """
    is_invite = not payload.password
    if is_invite:
        password_hash = "!" + secrets.token_hex(32)  # неподходящий под bcrypt-формат
        is_active = False
    else:
        password_hash = hash_password(payload.password or "")
        is_active = payload.is_active

    user = User(
        email=payload.email,
        password_hash=password_hash,
        full_name=payload.full_name,
        role=payload.role,
        is_active=is_active,
        telegram=payload.telegram,
        initials=compute_initials(payload.full_name),
        color=_pick_color(payload.email),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "email_exists",
            "Пользователь с таким email уже существует",
        ) from e

    raw_token: str | None = None
    if is_invite:
        raw_token = await _create_invite(db, user_id=user.id)

    await db.commit()
    await db.refresh(user)

    fallback_token: str | None = None
    if is_invite and raw_token is not None:
        sent = await _send_invite_email(
            to=user.email, full_name=user.full_name, raw_token=raw_token
        )
        # Если SMTP не настроен / упал — возвращаем токен наружу. На проде с
        # рабочим SMTP это всегда None и админ не увидит токен.
        if not sent:
            fallback_token = raw_token
    return user, fallback_token


async def reissue_invite(db: AsyncSession, user_id: uuid.UUID) -> tuple[User, str | None]:
    """Сгенерировать новый invite и отправить письмо повторно.

    Допустимо только для не-активированных пользователей (is_active=false). Старые
    активные invite-токены не отзываем явно: новый получит свой `token_hash`, при
    активации мы всё равно отметим конкретный токен как `used` (одноразовость).
    Если хочется строгости — можно дописать UPDATE used_at=now() WHERE user_id=…
    AND used_at IS NULL, но пока не вижу сценария, где это критично.
    """
    user = await get_user(db, user_id)
    if user.is_active:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "already_active",
            "Пользователь уже активирован — повторное приглашение не нужно",
        )
    raw_token = await _create_invite(db, user_id=user.id)
    await db.commit()
    sent = await _send_invite_email(
        to=user.email, full_name=user.full_name, raw_token=raw_token
    )
    return user, (None if sent else raw_token)


async def update_user(
    db: AsyncSession, user_id: uuid.UUID, payload: UpdateUserRequest
) -> User:
    user = await get_user(db, user_id)
    data = payload.model_dump(exclude_unset=True)
    if "email" in data:
        user.email = data["email"]
    if "full_name" in data:
        user.full_name = data["full_name"]
        user.initials = compute_initials(data["full_name"])
    if "role" in data:
        user.role = data["role"]
    if "telegram" in data:
        user.telegram = data["telegram"]
    if "is_active" in data:
        user.is_active = data["is_active"]
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT, "email_exists", "Email уже занят"
        ) from e
    await db.refresh(user)
    return user


async def update_profile(
    db: AsyncSession, user_id: uuid.UUID, payload: UpdateProfileRequest
) -> User:
    user = await get_user(db, user_id)
    data = payload.model_dump(exclude_unset=True)
    if "email" in data:
        user.email = data["email"]
    if "full_name" in data:
        user.full_name = data["full_name"]
        user.initials = compute_initials(data["full_name"])
    if "telegram" in data:
        user.telegram = data["telegram"]
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT, "email_exists", "Email уже занят"
        ) from e
    await db.refresh(user)
    return user


async def delete_user(db: AsyncSession, user_id: uuid.UUID, *, actor_id: uuid.UUID) -> None:
    if user_id == actor_id:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "cannot_delete_self",
            "Нельзя удалить собственный аккаунт",
        )
    user = await get_user(db, user_id)
    await db.delete(user)
    await db.commit()


# ── Invite activation (вызывается из /auth/invite/{token}/*) ──────────────


async def _find_active_invite(db: AsyncSession, raw_token: str) -> PasswordInvite:
    """Вернуть валидный invite или поднять ApiError."""
    th = hash_token(raw_token)
    invite = (
        await db.execute(select(PasswordInvite).where(PasswordInvite.token_hash == th))
    ).scalar_one_or_none()
    if invite is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "invite_not_found",
            "Ссылка приглашения не найдена",
        )
    if invite.used_at is not None:
        raise ApiError(
            status.HTTP_410_GONE, "invite_used", "Ссылка приглашения уже использована"
        )
    # expires_at — TZ-aware (DateTime(timezone=True)).
    if invite.expires_at < datetime.now(UTC):
        raise ApiError(
            status.HTTP_410_GONE, "invite_expired", "Срок действия ссылки истёк"
        )
    return invite


async def peek_invite(db: AsyncSession, raw_token: str) -> tuple[User, PasswordInvite]:
    """Проверить invite-токен и вернуть юзера + invite. Без модификаций."""
    invite = await _find_active_invite(db, raw_token)
    user = await db.get(User, invite.user_id)
    if user is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "invite_not_found",
            "Пользователь приглашения не найден",
        )
    return user, invite


async def activate_invite(db: AsyncSession, raw_token: str, *, new_password: str) -> User:
    """Активировать аккаунт: установить пароль, погасить invite, выставить is_active."""
    invite = await _find_active_invite(db, raw_token)
    user = await db.get(User, invite.user_id)
    if user is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "invite_not_found",
            "Пользователь приглашения не найден",
        )
    user.password_hash = hash_password(new_password)
    user.is_active = True
    invite.used_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(user)
    return user
