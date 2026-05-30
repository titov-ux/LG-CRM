"""Сервис календаря (события / собеседования).

Бизнес-правила:
* создание `interview`-события со связкой `match_id` двигает связку в стадию
  `interview` (если она ещё раньше по воронке) — переиспользуем
  `matching.service.update_match`, чтобы сработали уведомления и realtime;
* отметка исхода `held`/`no_show` пишет `outcome` в `vacancy_candidates.feedback`
  и опционально переводит связку в `next_match_status`;
* видимость: admin / account_manager видят все события; остальные — только те,
  где они участники, автор, либо ответственны по вакансии события.

Коллизии слотов разрешены — никаких проверок пересечения времени нет.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ApiError
from app.modules.calendar.models import (
    CalendarEvent,
    CalendarEventAttendee,
    EventStatus,
    EventType,
)
from app.modules.calendar.schemas import (
    CalendarEventResponse,
    CreateEventRequest,
    EventAttendeeDTO,
    OutcomeRequest,
    UpdateEventRequest,
)
from app.modules.candidates.models import Candidate
from app.modules.matching import service as matching_service
from app.modules.matching.models import MatchStatus, VacancyCandidate
from app.modules.matching.schemas import UpdateMatchRequest
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind
from app.modules.users.models import Role, User
from app.modules.vacancies.models import Vacancy, VacancyRecruiter
from app.realtime.events import publish_calendar_event

# Стадии связки, которые «раньше» собеседования по воронке — их апаем до
# interview при назначении собеса.
_PRE_INTERVIEW = {MatchStatus.submitted, MatchStatus.reviewed}


# --- helpers ---------------------------------------------------------------


async def _load(db: AsyncSession, event_id: uuid.UUID) -> CalendarEvent:
    event = (
        await db.execute(
            select(CalendarEvent)
            .where(CalendarEvent.id == event_id)
            .options(selectinload(CalendarEvent.attendees))
        )
    ).scalar_one_or_none()
    if event is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Событие не найдено")
    return event


async def _attendee_audience(event: CalendarEvent) -> set[uuid.UUID]:
    ids = {a.user_id for a in event.attendees}
    if event.created_by_id is not None:
        ids.add(event.created_by_id)
    return ids


async def _names_for(
    db: AsyncSession, events: list[CalendarEvent]
) -> tuple[dict[uuid.UUID, str], dict[uuid.UUID, str], dict[uuid.UUID, str]]:
    """Подтянуть имена кандидатов, названия вакансий и имена участников разом."""
    cand_ids = {e.candidate_id for e in events if e.candidate_id}
    vac_ids = {e.vacancy_id for e in events if e.vacancy_id}
    user_ids: set[uuid.UUID] = set()
    for e in events:
        for a in e.attendees:
            user_ids.add(a.user_id)

    cand_names: dict[uuid.UUID, str] = {}
    if cand_ids:
        rows = await db.execute(
            select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(cand_ids))
        )
        cand_names = {cid: name for cid, name in rows.all()}

    vac_titles: dict[uuid.UUID, str] = {}
    if vac_ids:
        rows = await db.execute(
            select(Vacancy.id, Vacancy.title).where(Vacancy.id.in_(vac_ids))
        )
        vac_titles = {vid: title for vid, title in rows.all()}

    user_names: dict[uuid.UUID, str] = {}
    if user_ids:
        rows = await db.execute(
            select(User.id, User.full_name).where(User.id.in_(user_ids))
        )
        user_names = {uid: name for uid, name in rows.all()}

    return cand_names, vac_titles, user_names


def _auto_title(
    cand_name: str | None, vac_title: str | None, event_type: EventType
) -> str:
    if event_type == EventType.interview:
        who = cand_name or "кандидат"
        if vac_title:
            return f"Собес: {who} — {vac_title}"
        return f"Собес: {who}"
    return "Событие"


def _to_dto(
    event: CalendarEvent,
    *,
    cand_names: dict[uuid.UUID, str],
    vac_titles: dict[uuid.UUID, str],
    user_names: dict[uuid.UUID, str],
) -> CalendarEventResponse:
    attendees = [
        EventAttendeeDTO(
            user_id=a.user_id,
            response=a.response,
            name=user_names.get(a.user_id),
        )
        for a in event.attendees
    ]
    return CalendarEventResponse(
        id=event.id,
        type=event.type,
        title=event.title,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        all_day=event.all_day,
        location_kind=event.location_kind,
        location=event.location,
        status=event.status,
        outcome=event.outcome,
        candidate_id=event.candidate_id,
        vacancy_id=event.vacancy_id,
        match_id=event.match_id,
        created_by_id=event.created_by_id,
        created_at=event.created_at,
        updated_at=event.updated_at,
        attendees=attendees,
        candidate_name=cand_names.get(event.candidate_id) if event.candidate_id else None,
        vacancy_title=vac_titles.get(event.vacancy_id) if event.vacancy_id else None,
    )


async def to_dto(db: AsyncSession, event: CalendarEvent) -> CalendarEventResponse:
    cand_names, vac_titles, user_names = await _names_for(db, [event])
    return _to_dto(
        event, cand_names=cand_names, vac_titles=vac_titles, user_names=user_names
    )


# --- queries ---------------------------------------------------------------


async def _visible_vacancy_ids(db: AsyncSession, user: User) -> set[uuid.UUID]:
    """Вакансии, по которым пользователь ответственен (рекрутер или AM)."""
    rows = await db.execute(
        select(VacancyRecruiter.vacancy_id).where(VacancyRecruiter.user_id == user.id)
    )
    ids = set(rows.scalars().all())
    rows = await db.execute(
        select(Vacancy.id).where(Vacancy.account_manager_id == user.id)
    )
    ids |= set(rows.scalars().all())
    return ids


async def list_range(
    db: AsyncSession,
    user: User,
    *,
    from_dt: datetime,
    to_dt: datetime,
    recruiter_id: uuid.UUID | None = None,
    vacancy_id: uuid.UUID | None = None,
    candidate_id: uuid.UUID | None = None,
    status_filter: EventStatus | None = None,
    type_filter: EventType | None = None,
) -> list[CalendarEventResponse]:
    stmt = (
        select(CalendarEvent)
        .where(CalendarEvent.starts_at >= from_dt, CalendarEvent.starts_at < to_dt)
        .options(selectinload(CalendarEvent.attendees))
        .order_by(CalendarEvent.starts_at.asc())
    )
    if vacancy_id is not None:
        stmt = stmt.where(CalendarEvent.vacancy_id == vacancy_id)
    if candidate_id is not None:
        stmt = stmt.where(CalendarEvent.candidate_id == candidate_id)
    if status_filter is not None:
        stmt = stmt.where(CalendarEvent.status == status_filter)
    if type_filter is not None:
        stmt = stmt.where(CalendarEvent.type == type_filter)
    if recruiter_id is not None:
        stmt = stmt.where(
            CalendarEvent.id.in_(
                select(CalendarEventAttendee.event_id).where(
                    CalendarEventAttendee.user_id == recruiter_id
                )
            )
        )

    # Видимость: admin/AM — всё; остальным — только свои.
    if user.role not in (Role.admin, Role.account_manager):
        vac_ids = await _visible_vacancy_ids(db, user)
        own = select(CalendarEventAttendee.event_id).where(
            CalendarEventAttendee.user_id == user.id
        )
        conds = [
            CalendarEvent.created_by_id == user.id,
            CalendarEvent.id.in_(own),
        ]
        if vac_ids:
            conds.append(CalendarEvent.vacancy_id.in_(vac_ids))
        stmt = stmt.where(or_(*conds))

    events = list((await db.execute(stmt)).scalars().all())
    cand_names, vac_titles, user_names = await _names_for(db, events)
    return [
        _to_dto(e, cand_names=cand_names, vac_titles=vac_titles, user_names=user_names)
        for e in events
    ]


# --- mutations -------------------------------------------------------------


async def _sync_attendees(
    event: CalendarEvent, attendee_ids: list[uuid.UUID]
) -> None:
    wanted = set(attendee_ids)
    current = {a.user_id for a in event.attendees}
    for a in list(event.attendees):
        if a.user_id not in wanted:
            event.attendees.remove(a)
    for uid in wanted - current:
        event.attendees.append(CalendarEventAttendee(user_id=uid))


async def create(
    db: AsyncSession, user: User, payload: CreateEventRequest
) -> CalendarEventResponse:
    # Валидируем ссылки на сущности (мягко — допускаем событие без привязок).
    cand: Candidate | None = None
    if payload.candidate_id is not None:
        cand = await db.get(Candidate, payload.candidate_id)
        if cand is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Кандидат не найден")
    vac: Vacancy | None = None
    if payload.vacancy_id is not None:
        vac = await db.get(Vacancy, payload.vacancy_id)
        if vac is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Вакансия не найдена")

    match: VacancyCandidate | None = None
    if payload.match_id is not None:
        match = await db.get(VacancyCandidate, payload.match_id)
        if match is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Связка не найдена")

    title = payload.title or _auto_title(
        cand.full_name if cand else None,
        vac.title if vac else None,
        payload.type,
    )

    event = CalendarEvent(
        type=payload.type,
        title=title,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        all_day=payload.all_day,
        location_kind=payload.location_kind,
        location=payload.location,
        status=EventStatus.scheduled,
        candidate_id=payload.candidate_id,
        vacancy_id=payload.vacancy_id,
        match_id=payload.match_id,
        created_by_id=user.id,
    )
    for uid in set(payload.attendee_ids):
        event.attendees.append(CalendarEventAttendee(user_id=uid))
    db.add(event)
    await db.flush()

    # Назначение собеса двигает связку в стадию interview.
    if (
        payload.type == EventType.interview
        and match is not None
        and match.status in _PRE_INTERVIEW
    ):
        await matching_service.update_match(
            db, match.id, UpdateMatchRequest(status=MatchStatus.interview)
        )

    # Уведомить участников (кроме автора).
    audience = {a.user_id for a in event.attendees}
    audience.discard(user.id)
    if audience:
        await notify_service.notify_many(
            db,
            recipient_ids=audience,
            kind=NotificationKind.status_change,
            text=f"Назначено собеседование: {event.title}",
            entity_type=NotificationEntityType.event,
            entity_id=event.id,
            payload={"startsAt": event.starts_at.isoformat()},
        )

    await db.commit()
    event = await _load(db, event.id)
    publish_calendar_event(
        "created",
        event_id=event.id,
        audience=await _attendee_audience(event),
        actor_id=user.id,
    )
    return await to_dto(db, event)


async def update(
    db: AsyncSession, user: User, event_id: uuid.UUID, payload: UpdateEventRequest
) -> CalendarEventResponse:
    event = await _load(db, event_id)
    rescheduled = False
    if payload.title is not None:
        event.title = payload.title
    if payload.starts_at is not None and payload.starts_at != event.starts_at:
        event.starts_at = payload.starts_at
        event.reminder_sent_at = None  # перенос → напомнить заново
        rescheduled = True
    if payload.ends_at is not None:
        event.ends_at = payload.ends_at
    if payload.all_day is not None:
        event.all_day = payload.all_day
    if payload.location_kind is not None:
        event.location_kind = payload.location_kind
    if payload.location is not None:
        event.location = payload.location
    if payload.attendee_ids is not None:
        await _sync_attendees(event, payload.attendee_ids)

    await db.commit()
    event = await _load(db, event_id)

    if rescheduled:
        audience = {a.user_id for a in event.attendees}
        audience.discard(user.id)
        if audience:
            await notify_service.notify_many(
                db,
                recipient_ids=audience,
                kind=NotificationKind.status_change,
                text=f"Перенос собеседования: {event.title}",
                entity_type=NotificationEntityType.event,
                entity_id=event.id,
                payload={"startsAt": event.starts_at.isoformat()},
            )
            await db.commit()

    publish_calendar_event(
        "updated",
        event_id=event.id,
        audience=await _attendee_audience(event),
        actor_id=user.id,
    )
    return await to_dto(db, event)


async def set_outcome(
    db: AsyncSession, user: User, event_id: uuid.UUID, payload: OutcomeRequest
) -> CalendarEventResponse:
    if payload.status not in (EventStatus.held, EventStatus.no_show):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_outcome",
            "Исход может быть только «состоялось» или «не пришёл»",
        )
    event = await _load(db, event_id)
    event.status = payload.status
    if payload.outcome is not None:
        event.outcome = payload.outcome

    # Записать исход в фидбэк связки и при необходимости сдвинуть её статус.
    if event.match_id is not None and (
        payload.outcome or payload.next_match_status is not None
    ):
        await matching_service.update_match(
            db,
            event.match_id,
            UpdateMatchRequest(
                status=payload.next_match_status,
                feedback=payload.outcome,
            ),
        )

    await db.commit()
    event = await _load(db, event_id)
    publish_calendar_event(
        "updated",
        event_id=event.id,
        audience=await _attendee_audience(event),
        actor_id=user.id,
    )
    return await to_dto(db, event)


async def cancel(
    db: AsyncSession, user: User, event_id: uuid.UUID, reason: str | None
) -> CalendarEventResponse:
    event = await _load(db, event_id)
    event.status = EventStatus.canceled
    if reason:
        event.outcome = reason

    audience = {a.user_id for a in event.attendees}
    audience.discard(user.id)
    if audience:
        await notify_service.notify_many(
            db,
            recipient_ids=audience,
            kind=NotificationKind.status_change,
            text=f"Отменено собеседование: {event.title}",
            entity_type=NotificationEntityType.event,
            entity_id=event.id,
            payload={"reason": reason or ""},
        )

    await db.commit()
    event = await _load(db, event_id)
    publish_calendar_event(
        "canceled",
        event_id=event.id,
        audience=await _attendee_audience(event),
        actor_id=user.id,
    )
    return await to_dto(db, event)


async def delete(db: AsyncSession, user: User, event_id: uuid.UUID) -> None:
    event = await _load(db, event_id)
    audience = await _attendee_audience(event)
    await db.delete(event)
    await db.commit()
    publish_calendar_event(
        "deleted", event_id=event_id, audience=audience, actor_id=user.id
    )


async def get(db: AsyncSession, event_id: uuid.UUID) -> CalendarEventResponse:
    event = await _load(db, event_id)
    return await to_dto(db, event)
