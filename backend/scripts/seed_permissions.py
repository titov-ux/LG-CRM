"""Заливает дефолтную матрицу прав, если таблица пуста.

Идемпотентно: если permissions_matrix непустая — ничего не делает.
Запускается после `alembic upgrade head`.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.db.session import SessionLocal
from app.modules.permissions.defaults import clone_defaults
from app.modules.permissions.models import PermissionRow


async def seed_permissions() -> None:
    async with SessionLocal() as db:
        existing = (await db.execute(select(PermissionRow.id))).scalars().first()
        if existing is not None:
            print("[seed_permissions] таблица не пуста — пропускаю")
            return
        for p in clone_defaults():
            db.add(
                PermissionRow(
                    id=p["id"],
                    group=p["group"],
                    permission=p["permission"],
                    description=p["description"],
                    actions=list(p["actions"]),
                    matrix=dict(p["matrix"]),
                )
            )
        await db.commit()
        print(f"[seed_permissions] залито {len(clone_defaults())} строк")


def main() -> None:
    asyncio.run(seed_permissions())


if __name__ == "__main__":
    main()
