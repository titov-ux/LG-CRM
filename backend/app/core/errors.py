"""Доменные исключения и общий формат ApiError.

Формат соответствует схеме `ApiError` в openapi.yaml:
    { "code": "engagement_type_mismatch", "message": "...", "details": {...} }
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status


class ApiError(HTTPException):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            status_code=status_code,
            detail={"code": code, "message": message, "details": details or {}},
        )


class NotFound(ApiError):
    def __init__(self, what: str = "Объект не найден") -> None:
        super().__init__(status.HTTP_404_NOT_FOUND, "not_found", what)


class Forbidden(ApiError):
    def __init__(self, message: str = "Нет прав на действие") -> None:
        super().__init__(status.HTTP_403_FORBIDDEN, "forbidden", message)


class Conflict(ApiError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(status.HTTP_409_CONFLICT, code, message, details)
