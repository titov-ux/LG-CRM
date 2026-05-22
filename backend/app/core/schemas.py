"""Базовая Pydantic-модель для всех Response/Request-DTO.

Контракт с фронтом — camelCase (см. `frontend/src/api/types.ts` и `types.gen.ts`).
В Python у нас snake_case → используем глобальный alias_generator.

`populate_by_name = True` — позволяет принимать и snake_case (внутри Python),
и camelCase (с фронта).
`from_attributes = True` — для построения из SQLAlchemy-объектов через
`UserResponse.model_validate(user_orm)`.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
