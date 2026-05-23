"""Эндпоинты /permissions-matrix.

Чтение — для всех авторизованных (фронту нужно для `can(...)`-логики).
Изменение — только admin (право `users.manage` стоит на нём).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user, require_roles
from app.modules.permissions import service
from app.modules.permissions.models import PermissionRow
from app.modules.permissions.schemas import (
    MatrixListResponse,
    MatrixPermission,
    UpdateMatrixRequest,
)
from app.modules.users.models import Role, User

router = APIRouter(prefix="/permissions-matrix", tags=["permissions"])


def _row_to_dto(row: PermissionRow) -> MatrixPermission:
    return MatrixPermission.model_validate(row.to_dict())


@router.get("", response_model=MatrixListResponse, summary="Матрица прав")
async def list_matrix(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MatrixListResponse:
    rows = await service.list_matrix(db)
    return MatrixListResponse(items=[_row_to_dto(r) for r in rows])


@router.put("/{row_id}", response_model=MatrixPermission, summary="Обновить строку матрицы")
async def update_row(
    row_id: str,
    payload: UpdateMatrixRequest,
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> MatrixPermission:
    row = await service.update_row(db, row_id, payload.matrix)
    return _row_to_dto(row)


@router.post("/reset", response_model=MatrixListResponse, summary="Сбросить матрицу к дефолту")
async def reset_matrix(
    _: User = Depends(require_roles(Role.admin.value)),
    db: AsyncSession = Depends(get_db),
) -> MatrixListResponse:
    rows = await service.reset(db)
    return MatrixListResponse(items=[_row_to_dto(r) for r in rows])
