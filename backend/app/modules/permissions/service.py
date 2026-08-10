"""Бизнес-логика permissions-matrix."""
from __future__ import annotations

from fastapi import status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError, Forbidden
from app.modules.permissions.defaults import clone_defaults
from app.modules.permissions.models import PermissionRow
from app.modules.users.models import User

# Все «известные» роли — фронту нужен полный словарь для каждой строки.
_VALID_ROLES = {"admin", "account_manager", "recruiter", "viewer"}


async def user_has_action(db: AsyncSession, user: User, action: str) -> bool:
    """Проверить action (`screening:run`, …) по permissions_matrix для роли юзера.

    Матрица — источник правды (админ может выключить право даже у admin).
    Если строки с action нет в БД — fallback на дефолты из `defaults.py`.
    """
    role_key = user.role.value if hasattr(user.role, "value") else str(user.role)
    rows = await list_matrix(db)
    for row in rows:
        actions = row.actions or []
        if action in actions:
            return bool((row.matrix or {}).get(role_key, False))
    for p in clone_defaults():
        if action in p["actions"]:
            return bool(p["matrix"].get(role_key, False))
    return False


async def require_action(
    db: AsyncSession,
    user: User,
    action: str,
    *,
    message: str | None = None,
) -> None:
    """403, если у роли юзера нет `action` в матрице."""
    if not await user_has_action(db, user, action):
        raise Forbidden(message or "Недостаточно прав")


async def list_matrix(db: AsyncSession) -> list[PermissionRow]:
    rows = (await db.execute(select(PermissionRow).order_by(PermissionRow.id))).scalars().all()
    if not rows:
        # Лениво сидируем при первом обращении — на случай, если миграция накатана,
        # а seed-скрипт ещё не запускался (например, локально на чистой БД).
        await _seed_defaults(db)
        rows = (await db.execute(select(PermissionRow).order_by(PermissionRow.id))).scalars().all()
    elif await _sync_missing_defaults(db, rows):
        # Таблица уже засижена, но в дефолтах появились новые строки (например,
        # `calendar.*` после добавления модуля календаря). Полный re-seed бывает
        # только при пустой таблице и при /reset, поэтому новые права иначе
        # никогда не доезжают до существующей БД, и фронт (deny-by-default)
        # прячет соответствующие действия. Доинсёрчиваем недостающее, НЕ трогая
        # уже настроенные администратором матрицы.
        rows = (await db.execute(select(PermissionRow).order_by(PermissionRow.id))).scalars().all()
    return list(rows)


async def _sync_missing_defaults(
    db: AsyncSession, existing: list[PermissionRow]
) -> bool:
    """Вставить отсутствующие дефолтные строки. True — если что-то добавили."""
    existing_ids = {r.id for r in existing}
    added = False
    for p in clone_defaults():
        if p["id"] in existing_ids:
            continue
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
        added = True
    if added:
        await db.commit()
    return added


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
