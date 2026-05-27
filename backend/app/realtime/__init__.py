"""Realtime-подсистема: Redis pub/sub шина + WebSocket /ws/events + presence-store.

Используется фронтом, чтобы канбан-доски вакансий и кандидатов обновлялись
у всех открытых клиентов сразу, без polling-а. Presence-store отдаёт точный
список онлайн юзеров, согласованный между uvicorn-воркерами.
"""
from app.realtime.bus import EventBus, get_bus
from app.realtime.events import (
    publish_candidate_changed,
    publish_chat_event,
    publish_user_presence_event,
    publish_vacancy_changed,
    current_client_id_var,
)
from app.realtime.presence import (
    PresenceStore,
    get_presence_store,
    set_presence_store_for_tests,
    start_sweeper,
    stop_sweeper,
)

__all__ = [
    "EventBus",
    "get_bus",
    "publish_candidate_changed",
    "publish_chat_event",
    "publish_user_presence_event",
    "publish_vacancy_changed",
    "current_client_id_var",
    "PresenceStore",
    "get_presence_store",
    "set_presence_store_for_tests",
    "start_sweeper",
    "stop_sweeper",
]
