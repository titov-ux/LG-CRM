"""DTO модуля calendar.

Контракт с фронтом — camelCase (см. CamelModel). Список событий отдаётся
«толстым» (с именем кандидата и названием вакансии), чтобы сетка календаря не
делала N доп-запросов — в духе perf-паттернов проекта.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from app.core.schemas import CamelModel
from app.modules.calendar.models import (
    AttendeeResponse,
    EventLocationKind,
    EventStatus,
    EventType,
)
from app.modules.matching.models import MatchStatus


class EventAttendeeDTO(CamelModel):
    user_id: uuid.UUID
    response: AttendeeResponse
    # Имя — для рендера без доп-запроса; заполняется сервисом, может быть None.
    name: str | None = None


class CalendarEventResponse(CamelModel):
    id: uuid.UUID
    type: EventType
    title: str
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    location_kind: EventLocationKind
    location: str | None = None
    status: EventStatus
    outcome: str | None = None
    candidate_id: uuid.UUID | None = None
    vacancy_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None
    created_by_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    attendees: list[EventAttendeeDTO] = []
    # Денормализованные подписи для сетки/списка (не ORM-поля).
    candidate_name: str | None = None
    vacancy_title: str | None = None


class CreateEventRequest(CamelModel):
    type: EventType = EventType.interview
    title: str | None = None  # None → автогенерация «Собес: ФИО — Вакансия»
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    location_kind: EventLocationKind = EventLocationKind.online
    location: str | None = None
    candidate_id: uuid.UUID | None = None
    vacancy_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None
    attendee_ids: list[uuid.UUID] = []


class UpdateEventRequest(CamelModel):
    """Все поля опциональны — перенос/правка участников/места.

    `attendee_ids=None` означает «не трогать участников»; пустой список — снять
    всех. Различаем именно через None vs [].
    """

    title: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None
    location_kind: EventLocationKind | None = None
    location: str | None = None
    attendee_ids: list[uuid.UUID] | None = None


class OutcomeRequest(CamelModel):
    """Отметить, что собес состоялся / кандидат не пришёл."""

    status: EventStatus  # ожидается held | no_show
    outcome: str | None = None
    # Если задан — заодно перевести связку кандидат↔вакансия в этот статус.
    next_match_status: MatchStatus | None = None


class CancelRequest(CamelModel):
    reason: str | None = None
