"""Курс USD→RUB для пересчёта ставок иностранных заказчиков в рубли.

Источник — официальный курс ЦБ РФ (JSON-зеркало cbr-xml-daily.ru, бесплатно,
без ключа). Курс кэшируется в Redis:
  * `fx:usd_rub`       — свежий, TTL 3 часа (ЦБ меняет курс раз в день);
  * `fx:usd_rub:last`  — последний успешно полученный, без TTL — на случай,
                         если ЦБ временно недоступен.
Если нет ни того, ни другого — `settings.fx_usd_rub_fallback` (0 = курса нет).

Маржа считается в рублях: себестоимость кандидата у нас в ₽, поэтому
долларовая выручка переводится по текущему курсу ЦБ.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass

import httpx

from app.core.config import get_settings
from app.core.redis import get_redis

log = logging.getLogger(__name__)

_KEY = "fx:usd_rub"
_KEY_LAST = "fx:usd_rub:last"
_TTL_SECONDS = 3 * 60 * 60


@dataclass
class FxRate:
    usd_rub: float | None
    date: str | None
    source: str | None  # "cbr" | "cbr_cached" | "fallback" | None


async def _fetch_cbr() -> FxRate | None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            resp = await http.get(settings.fx_cbr_url)
            resp.raise_for_status()
            # Отдаётся как application/javascript — парсим текст вручную.
            data = json.loads(resp.text)
        value = float(data["Valute"]["USD"]["Value"])
        nominal = float(data["Valute"]["USD"].get("Nominal") or 1)
        if value <= 0:
            return None
        return FxRate(usd_rub=round(value / nominal, 4), date=str(data.get("Date", ""))[:10], source="cbr")
    except Exception as exc:
        log.warning("fx: не удалось получить курс ЦБ: %s", exc)
        return None


async def _redis_get(key: str) -> FxRate | None:
    try:
        raw = await get_redis().get(key)
    except Exception as exc:
        log.warning("fx: redis недоступен: %s", exc)
        return None
    if not raw:
        return None
    try:
        return FxRate(**json.loads(raw))
    except Exception:
        return None


async def _redis_set(rate: FxRate) -> None:
    try:
        raw = json.dumps(asdict(rate))
        r = get_redis()
        await r.set(_KEY, raw, ex=_TTL_SECONDS)
        await r.set(_KEY_LAST, raw)
    except Exception as exc:
        log.warning("fx: не удалось закэшировать курс: %s", exc)


async def get_usd_rub() -> FxRate:
    cached = await _redis_get(_KEY)
    if cached and cached.usd_rub:
        return cached
    fresh = await _fetch_cbr()
    if fresh is not None:
        await _redis_set(fresh)
        return fresh
    last = await _redis_get(_KEY_LAST)
    if last and last.usd_rub:
        return FxRate(usd_rub=last.usd_rub, date=last.date, source="cbr_cached")
    fallback = get_settings().fx_usd_rub_fallback
    if fallback > 0:
        return FxRate(usd_rub=fallback, date=None, source="fallback")
    return FxRate(usd_rub=None, date=None, source=None)


def to_rub(amount: float, currency: str | None, usd_rub: float | None) -> float | None:
    """Сумма в рублях. None — если валюта USD, а курса нет."""
    if (currency or "RUB") == "RUB":
        return amount
    if currency == "USD" and usd_rub:
        return amount * usd_rub
    return None
