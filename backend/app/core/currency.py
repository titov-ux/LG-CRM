"""Валюта расчётов с клиентом.

RUB — российские клиенты (по умолчанию), USD — иностранные заказчики.
Хранится строкой в clients.currency / vacancies.currency (CHECK-ограничение
в миграции 0043_currency).
"""
from __future__ import annotations

from typing import Literal

Currency = Literal["RUB", "USD"]

DEFAULT_CURRENCY: Currency = "RUB"
