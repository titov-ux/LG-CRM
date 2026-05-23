"""Создать админа из ADMIN_EMAIL / ADMIN_PASSWORD.

Идемпотентно: если пользователь с таким email уже есть — ничего не делает
(пароль НЕ перезатирается). Запускается на первом старте проекта и в CI после
накатанных миграций.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.modules.users.models import Role, User, compute_initials


async def seed_admin() -> None:
    settings = get_settings()
    email = settings.admin_email
    password = settings.admin_password

    if not email or not password:
        raise RuntimeError("ADMIN_EMAIL / ADMIN_PASSWORD не заданы")

    async with SessionLocal() as db:
        existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if existing is not None:
            print(f"[seed_admin] user already exists: {email} (id={existing.id}) — skip")
            return
        admin = User(
            email=email,
            password_hash=hash_password(password),
            full_name="Администратор",
            role=Role.admin,
            is_active=True,
            initials=compute_initials("Администратор"),
            color="#0ea5e9",
        )
        db.add(admin)
        await db.commit()
        await db.refresh(admin)
        print(f"[seed_admin] created admin {admin.email} (id={admin.id})")


def main() -> None:
    asyncio.run(seed_admin())


if __name__ == "__main__":
    main()
