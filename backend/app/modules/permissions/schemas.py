"""DTO модуля permissions.

Все строки матрицы возвращаются скопом через `MatrixListResponse`, чтобы
фронт мог одним вызовом подтянуть все 14 строк. PUT обновляет только колонку
matrix конкретной строки.
"""
from __future__ import annotations

from pydantic import Field

from app.core.schemas import CamelModel


class MatrixPermission(CamelModel):
    id: str
    group: str
    permission: str
    description: str
    actions: list[str] = Field(default_factory=list)
    matrix: dict[str, bool] = Field(default_factory=dict)


class MatrixListResponse(CamelModel):
    items: list[MatrixPermission]


class UpdateMatrixRequest(CamelModel):
    matrix: dict[str, bool]
