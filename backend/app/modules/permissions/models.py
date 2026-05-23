"""SQLAlchemy-модель `permissions_matrix`.

Структура соответствует фронтовой `MatrixPermission` (lib/permissions-data.ts):
один ряд = одна строка матрицы; `matrix` — JSON-словарь `{ role: boolean }`.

Дефолты лежат в `app/modules/permissions/defaults.py` и сидятся в таблицу при
первом запуске (см. `scripts/seed_permissions.py`). Источник истины во время
работы — БД.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampsMixin


class PermissionRow(Base, TimestampsMixin):
    __tablename__ = "permissions_matrix"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    group: Mapped[str] = mapped_column(String(64), nullable=False)
    permission: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    actions: Mapped[list[str]] = mapped_column(JSONB().with_variant(JSON, "sqlite"), nullable=False, default=list)
    matrix: Mapped[dict[str, bool]] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=dict,
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "group": self.group,
            "permission": self.permission,
            "description": self.description,
            "actions": list(self.actions or []),
            "matrix": dict(self.matrix or {}),
        }
