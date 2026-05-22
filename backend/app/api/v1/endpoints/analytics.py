"""Эндпоинты /analytics/*.

Доступ — авторизованный пользователь. Контентовая фильтрация по ролям
(account_manager видит только свои) появится в Этапе 8 (см. план §4).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.analytics import service
from app.modules.analytics.schemas import (
    DashboardSummary,
    FunnelBucket,
    RecruiterLoad,
)
from app.modules.auth.dependencies import get_current_user
from app.modules.users.models import User

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary", response_model=DashboardSummary, summary="Сводка дашборда")
async def summary(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DashboardSummary:
    data = await service.summary(db)
    return DashboardSummary.model_validate(data)


@router.get("/funnel", response_model=list[FunnelBucket], summary="Воронка вакансий")
async def funnel(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FunnelBucket]:
    rows = await service.funnel(db)
    return [FunnelBucket.model_validate(r) for r in rows]


@router.get(
    "/recruiter-load", response_model=list[RecruiterLoad], summary="Нагрузка рекрутеров"
)
async def recruiter_load(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RecruiterLoad]:
    rows = await service.recruiter_load(db)
    return [RecruiterLoad.model_validate(r) for r in rows]
