"""Эндпоинт /fx — курс USD→RUB (ЦБ РФ) для пересчёта ставок иностранных заказчиков."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.schemas import CamelModel
from app.modules.auth.dependencies import get_current_user
from app.modules.fx import service
from app.modules.users.models import User

router = APIRouter(prefix="/fx", tags=["fx"])


class FxRatesResponse(CamelModel):
    # None — курс сейчас недоступен (ЦБ не ответил, кэша нет).
    usd_rub: float | None = None
    date: str | None = None
    source: str | None = None


@router.get("/rates", response_model=FxRatesResponse, summary="Курс USD→RUB (ЦБ РФ)")
async def get_rates(_: User = Depends(get_current_user)) -> FxRatesResponse:
    rate = await service.get_usd_rub()
    return FxRatesResponse(usd_rub=rate.usd_rub, date=rate.date, source=rate.source)
