"""Realtime-подсистема: in-memory pub/sub + WebSocket /ws/events.

Используется фронтом, чтобы канбан-доски вакансий и кандидатов обновлялись
у всех открытых клиентов сразу, без polling-а.
"""
from app.realtime.bus import EventBus, get_bus
from app.realtime.events import (
    publish_candidate_changed,
    publish_vacancy_changed,
    current_client_id_var,
)

__all__ = [
    "EventBus",
    "get_bus",
    "publish_candidate_changed",
    "publish_vacancy_changed",
    "current_client_id_var",
]
