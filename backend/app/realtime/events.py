"""Хелперы публикации realtime-событий.

Каждое событие — словарь с полями:
  - `type`: «vacancy.changed» / «candidate.changed»
  - `kind`: «created» / «updated» / «deleted» / «status_changed» / «reordered»
    / «archived» / «restored»
  - `id`: id затронутой сущности (если применимо)
  - `ids`: список id (для batch-операций типа reorder)
  - `actorId`: id пользователя, выполнившего действие
  - `clientId`: «X-Client-Id» из запроса, чтобы фронт мог отбрасывать
    собственные эхо-события
  - `ts`: ISO-время публикации

`current_client_id_var` — contextvar, который ставит middleware на каждый
запрос. Сервисы публикуют события, ничего не зная про request.
"""
from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Iterable, Literal

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
