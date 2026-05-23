"""Бизнес-логика модуля users.

Тонкий слой над SQLAlchemy — без HTTP-специфики, чтобы можно было дёргать из
seed-скриптов и фоновых задач.
"""
from __future__ import annotations

import secrets
import uuid

from fastapi import status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.security import hash_password
from app.modules.users.models import User, compute_initials
from app.modules.users.schemas import CreateUserRequest, UpdateProfileRequest, UpdateUserRequest

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


async def list_users(db: AsyncSession) -> list[User]:
    res = await db.execute(select(User).order_by(User.full_name))
    return list(res.scalars().all())


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Пользователь не найден")
    return user


async def create_user(db: AsyncSession, payload: CreateUserRequest) -> User:
    # Пароль может прийти пустым — генерируем временный и кладём как заглушку.
    # На реальном проде такой юзер заводится и потом получает приглашение по email.
    password = payload.password or secrets.token_urlsafe(16)
    user = User(
        email=payload.email,
        password_hash=hash_password(password),
        full_name=payload.full_name,
        role=payload.role,
        is_active=payload.is_active,
        telegram=payload.telegram,
        initials=compute_initials(payload.full_name),
        color=_pick_color(payload.email),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "email_exists",
            "Пользователь с таким email уже существует",
        ) from e
    await db.refresh(user)
    return user


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
