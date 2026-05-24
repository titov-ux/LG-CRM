"""Эндпоинты /analytics/*.

Доступ — авторизованный пользователь. Контентовая фильтрация по ролям
(account_manager видит только свои) появится в Этапе 8 (см. план §4).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.analytics import service
from app.modules.analytics.schemas import (
    AttentionResponse,
    ClientPerformanceResponse,
    DashboardSummary,
    FunnelBucket,
    FunnelResponse,
    RecruiterLoad,
    RecruiterPerformanceResponse,
    TimeToHireResponse,
    TrendsResponse,
)
from app.modules.auth.dependencies import get_current_user
from app.modules.users.models import User

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary", response_model=DashboardSummary, summary="Сводка дашборда")
async def summary(
    from_dt: datetime | None = Query(
        None,
        alias="from",
        description="Начало периода (ISO-8601). По умолчанию — начало текущего месяца.",
    ),
    to_dt: datetime | None = Query(
        None, alias="to", description="Конец периода (ISO-8601). По умолчанию — сейчас."
    ),
    compare: Literal["prev", "yoy", "none"] = Query(
        "prev",
        description="Окно для расчёта delta: prev (того же размера непосредственно перед), yoy (тот же диапазон год назад), none (без дельт).",
    ),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DashboardSummary:
    period = service.resolve_period(from_dt, to_dt)
    data = await service.summary(db, period=period, compare_mode=compare)
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


@router.get(
    "/trends",
    response_model=TrendsResponse,
    summary="Временные ряды: создано/закрыто вакансий, заведено кандидатов, наймы",
)
async def trends(
    from_dt: datetime | None = Query(None, alias="from"),
    to_dt: datetime | None = Query(None, alias="to"),
    granularity: Literal["auto", "day", "week", "month"] = Query(
        "auto",
        description="Гранулярность бакетов. auto: до 31 дня → day, до 180 → week, иначе → month.",
    ),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TrendsResponse:
    period = service.resolve_period(from_dt, to_dt)
    data = await service.trends(db, period=period, granularity=granularity)
    return TrendsResponse.model_validate(data)


@router.get(
    "/funnel-v2",
    response_model=FunnelResponse,
    summary="Воронка по VacancyCandidate с конверсиями и drop-off",
)
async def funnel_v2(
    from_dt: datetime | None = Query(None, alias="from"),
    to_dt: datetime | None = Query(None, alias="to"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FunnelResponse:
    period = service.resolve_period(from_dt, to_dt)
    data = await service.funnel_v2(db, period=period)
    return FunnelResponse.model_validate(data)


@router.get(
    "/time-to-hire",
    response_model=TimeToHireResponse,
    summary="Скорость найма: avg/median/p90, распределение, время по стадиям",
)
async def time_to_hire(
    from_dt: datetime | None = Query(None, alias="from"),
    to_dt: datetime | None = Query(None, alias="to"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TimeToHireResponse:
    period = service.resolve_period(from_dt, to_dt)
    data = await service.time_to_hire(db, period=period)
    return TimeToHireResponse.model_validate(data)


@router.get(
    "/attention",
    response_model=AttentionResponse,
    summary="Требует внимания: зависшие вакансии/кандидаты, дедлайны",
)
async def attention(
    top: int = Query(5, ge=1, le=20),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AttentionResponse:
    data = await service.attention(db, top=top)
    return AttentionResponse.model_validate(data)


@router.get(
    "/recruiter-performance",
    response_model=RecruiterPerformanceResponse,
    summary="Эффективность рекрутеров за период",
)
async def recruiter_performance(
    from_dt: datetime | None = Query(None, alias="from"),
    to_dt: datetime | None = Query(None, alias="to"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecruiterPerformanceResponse:
    period = service.resolve_period(from_dt, to_dt)
    data = await service.recruiter_performance(db, period=period)
    return RecruiterPerformanceResponse.model_validate(data)


@router.get(
    "/client-performance",
    response_model=ClientPerformanceResponse,
    summary="Аналитика по клиентам за период",
)
async def client_performance(
    from_dt: datetime | None = Query(None, alias="from"),
    to_dt: datetime | None = Query(None, alias="to"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClientPerformanceResponse:
    period = service.resolve_period(from_dt, to_dt)
    data = await service.client_performance(db, period=period)
    return ClientPerformanceResponse.model_validate(data)
