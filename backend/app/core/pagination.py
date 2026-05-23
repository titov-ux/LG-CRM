"""Утилиты пагинации.

На MVP — простая offset/pageSize-пагинация в формате `Page<T>` из фронтовых DTO.
Курсорная пагинация будет добавлена для тяжёлых списков (audit, candidates).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass
class PageParams:
    page: int = 1
    page_size: int = 50

    def offset(self) -> int:
        return (self.page - 1) * self.page_size


@dataclass
class Page(Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int

    def to_dict(self) -> dict[str, object]:
        return {
            "items": self.items,
            "total": self.total,
            "page": self.page,
            "pageSize": self.page_size,
        }
