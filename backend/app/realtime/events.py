"""Хелперы публикации realtime-событий.

Каждое событие — словарь с полями:
  - `type`: «vacancy.changed» / «candidate.changed» / «chat.*»
  - `kind`: «created» / «updated» / «deleted» / «status_changed» / «reordered»
    / «archived» / «restored» (для доменных событий — пусто или своё)
  - `id`: id затронутой сущности (если применимо)
  - `ids`: список id (для batch-операций типа reorder)
  - `actorId`: id пользователя, выполнившего действие
  - `clientId`: «X-Client-Id» из запроса, чтобы фронт мог отбрасывать
    собственные эхо-события
  - `ts`: ISO-время публикации
  - `audience` *(опционально)*: список user_id, которым событие предназначено.
    Если задан — `_pump_events` в `endpoints/realtime.py` отдаст событие
    только тем клиентам, чей `user.id` входит в этот список. Если не задан —
    событие летит всем (как было до §2.4 плана чата).

`current_client_id_var` — contextvar, который ставит middleware на каждый
запрос. Сервисы публикуют события, ничего не зная про request.
"""
from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Iterable, Literal

from app.realtime.bus import get_bus

logger = logging.getLogger(__name__)

# clientId — корреляция между фронт-вкладкой и её собственными событиями.
# Пустая строка = «нет X-Client-Id», эхо-фильтрация на фронте не сработает,
# но это не критично — просто лишний refetch.
current_client_id_var: ContextVar[str] = ContextVar("current_client_id", default="")


VacancyEventKind = Literal[
    "created", "updated", "deleted", "status_changed", "reordered"
]
CandidateEventKind = Literal[
    "created",
    "updated",
    "deleted",
    "status_changed",
    "reordered",
    "archived",
    "restored",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_uuid(value: uuid.UUID | None) -> str | None:
    return str(value) if value is not None else None


def publish_vacancy_changed(
    kind: VacancyEventKind,
    *,
    id: uuid.UUID | None = None,
    ids: Iterable[uuid.UUID] | None = None,
    actor_id: uuid.UUID | None = None,
) -> None:
    """Опубликовать событие об изменении вакансии.

    Безопасно для вызова из любого места — никогда не бросает исключений.
    """
    try:
        event = {
            "type": "vacancy.changed",
            "kind": kind,
            "id": _safe_uuid(id),
            "ids": [str(i) for i in (ids or [])],
            "actorId": _safe_uuid(actor_id),
            "clientId": current_client_id_var.get(""),
            "ts": _now_iso(),
        }
        get_bus().publish(event)
    except Exception:
        logger.exception("publish_vacancy_changed failed (suppressed)")


def publish_candidate_changed(
    kind: CandidateEventKind,
    *,
    id: uuid.UUID | None = None,
    ids: Iterable[uuid.UUID] | None = None,
    actor_id: uuid.UUID | None = None,
) -> None:
    """Опубликовать событие об изменении кандидата.

    Безопасно для вызова из любого места — никогда не бросает исключений.
    """
    try:
        event = {
            "type": "candidate.changed",
            "kind": kind,
            "id": _safe_uuid(id),
            "ids": [str(i) for i in (ids or [])],
            "actorId": _safe_uuid(actor_id),
            "clientId": current_client_id_var.get(""),
            "ts": _now_iso(),
        }
        get_bus().publish(event)
    except Exception:
        logger.exception("publish_candidate_changed failed (suppressed)")


# === Чат =====================================================================
# В отличие от vacancy/candidate, чат-события приватные: их видят только
# участники конкретного диалога. Audience — список user_id (строк) — кладётся
# в само событие, фильтрация на стороне `_pump_events`.
ChatEventType = Literal[
    "chat.message_created",
    "chat.message_updated",
    "chat.message_deleted",
    "chat.conversation_changed",
    "chat.read",
    "chat.reaction_changed",
]


def publish_chat_event(
    event_type: ChatEventType,
    *,
    audience: Iterable[uuid.UUID | str],
    payload: dict[str, Any] | None = None,
    actor_id: uuid.UUID | None = None,
) -> None:
    """Опубликовать чат-событие с приватной аудиторией.

    `audience` — список user_id, которым событие предназначено (обычно члены
    диалога). `payload` — произвольная JSON-safe нагрузка (см. §2.4 плана).
    Безопасно для вызова из любого места — не бросает исключений.
    """
    try:
        audience_list = [str(u) for u in audience]
        event: dict[str, Any] = {
            "type": event_type,
            "audience": audience_list,
            "actorId": _safe_uuid(actor_id),
            "clientId": current_client_id_var.get(""),
            "ts": _now_iso(),
            **(payload or {}),
        }
        get_bus().publish(event)
    except Exception:
        logger.exception("publish_chat_event failed (suppressed)")


def publish_user_presence_event(*, user_id: uuid.UUID | str, online: bool) -> None:
    """Опубликовать событие presence (online/offline) для пользователя.

    Событие публичное для всех подключенных пользователей CRM и не требует
    `audience`-фильтрации.
    """
    try:
        event: dict[str, Any] = {
            "type": "user.presence",
            "userId": str(user_id),
            "online": bool(online),
            "actorId": None,
            # presence рождается в ws-слое, поэтому clientId не привязываем.
            "clientId": "",
            "ts": _now_iso(),
        }
        get_bus().publish(event)
    except Exception:
        logger.exception("publish_user_presence_event failed (suppressed)")
