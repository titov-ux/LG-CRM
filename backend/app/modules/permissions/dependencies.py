"""FastAPI-зависимости для проверки прав по матрице доступов."""
from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.permissions.service import require_action
from app.modules.users.models import User


def require_action_dep(
    action: str, *, message: str | None = None
) -> Callable[..., Awaitable[None]]:
    """Зависимость «нужно право `action`» — для `dependencies=[...]` роутера
    или эндпоинта. Без права — 403 с `details.action`.
    """

    async def _dep(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> None:
        await require_action(db, user, action, message=message)

    return _dep
