"""FastAPI-зависимости для проверки прав по матрице доступов."""
from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.permissions.service import require_action
from app.modules.users.models import Role, User


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


def require_action_or_admin(
    action: str, *, message: str | None = None
) -> Callable[..., Awaitable[User]]:
    """Право `action` по матрице; администратор проходит всегда.

    Для административных разделов («Журнал действий», «Управление
    пользователями»): раньше они были жёстко зашиты на роль admin, и галочки
    в матрице ни на что не влияли. Админ остаётся «полом» — снятая по ошибке
    галочка не должна запирать единственного администратора снаружи.
    Возвращает текущего пользователя (нужен эндпоинтам как `actor`).
    """

    async def _dep(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if user.role != Role.admin:
            await require_action(db, user, action, message=message)
        return user

    return _dep
