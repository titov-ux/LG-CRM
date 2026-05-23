"""Бизнес-логика permissions-matrix."""
from __future__ import annotations

from fastapi import status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.permissions.defaults import clone_defaults
from app.modules.permissions.models import PermissionRow

# Все «известные» роли — фронту нужен полный словарь для каждой строки.
_VALID_ROLES = {"admin", "account_manager", "recruiter", "viewer"}


async def list_matrix(db: AsyncSession) -> list[PermissionRow]:
    rows = (await db.execute(select(PermissionRow).order_by(PermissionRow.id))).scalars().all()
    if not rows:
        # Лениво сидируем при первом обращении — на случай, если миграция накатана,
        # а seed-скрипт ещё не запускался (например, локально на чистой БД).
        await _seed_defaults(db)
        rows = (await db.execute(select(PermissionRow).order_by(PermissionRow.id))).scalars().all()
    return list(rows)


async def update_row(db: AsyncSession, row_id: str, matrix: dict[str, bool]) -> PermissionRow:
    invalid = set(matrix.keys()) - _VALID_ROLES
    if invalid:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "unknown_role",
            f"Неизвестные роли в матрице: {sorted(invalid)}",
        )

    row = await db.get(PermissionRow, row_id)
    if row is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Право не найдено")

    # Сохраняем существующие ключи + перезатираем пришедшими (на случай частичного апдейта).
    merged: dict[str, bool] = dict(row.matrix or {})
    merged.update({k: bool(v) for k, v in matrix.items()})
    row.matrix = merged
    await db.commit()
    await db.refresh(row)
    return row


async def reset(db: AsyncSession) -> list[PermissionRow]:
    await db.execute(delete(PermissionRow))
    await _seed_defaults(db)
    rows = (await db.execute(select(PermissionRow).order_by(PermissionRow.id))).scalars().all()
    return list(rows)


async def _seed_defaults(db: AsyncSession) -> None:
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
