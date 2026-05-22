"""Сервис аналитики.

На MVP — простые SQL-агрегаты прямо по основным таблицам. На Этапе 8+ это
переедет в материализованные представления Postgres (см. план §4 Этап 7).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.candidates.models import Candidate, CandidateStatus
from app.modules.vacancies.models import Vacancy, VacancyStatus


OPEN_VACANCY_STATUSES = (
    VacancyStatus.new,
    VacancyStatus.in_work,
    VacancyStatus.proposed,
    VacancyStatus.interview,
    VacancyStatus.waiting_os,
)
CLOSED_STATUSES = (VacancyStatus.closed, VacancyStatus.closed_success)
ACTIVE_CANDIDATE_STATUSES = (
    CandidateStatus.new,
    CandidateStatus.recruiter_iv,
    CandidateStatus.ready,
    CandidateStatus.presented,
    CandidateStatus.waiting_os,
    CandidateStatus.offer,
)


def _month_start(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _prev_month_start(dt: datetime) -> datetime:
    first = _month_start(dt)
    # последний день предыдущего месяца → его начало
    prev = first.replace(day=1) - (first - first.replace(day=1, hour=0))
    # эквивалент: вычитание timedelta — но проще:
    if first.month == 1:
        return first.replace(year=first.year - 1, month=12)
    return first.replace(month=first.month - 1)


def _delta_pct(curr: int, prev: int) -> float:
    if prev == 0:
        return 100.0 if curr > 0 else 0.0
    return round((curr - prev) * 100.0 / prev, 1)


async def summary(db: AsyncSession) -> dict:
    now = datetime.now(timezone.utc)
    this_month = _month_start(now)
    prev_month = _prev_month_start(now)

    # open vacancies (актуальное состояние)
    open_now = (
        await db.execute(
            select(func.count())
            .select_from(Vacancy)
            .where(
                Vacancy.deleted_at.is_(None), Vacancy.status.in_(OPEN_VACANCY_STATUSES)
            )
        )
    ).scalar_one()

    # active candidates (актуальное)
    active_now = (
        await db.execute(
            select(func.count())
            .select_from(Candidate)
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.archived.is_(False),
                Candidate.status.in_(ACTIVE_CANDIDATE_STATUSES),
            )
        )
    ).scalar_one()

    # closed this/prev month по дате последней смены статуса
    closed_this = (
        await db.execute(
            select(func.count())
            .select_from(Vacancy)
            .where(
                Vacancy.deleted_at.is_(None),
                Vacancy.status.in_(CLOSED_STATUSES),
                Vacancy.status_changed_at >= this_month,
            )
        )
    ).scalar_one()
    closed_prev = (
        await db.execute(
            select(func.count())
            .select_from(Vacancy)
            .where(
                Vacancy.deleted_at.is_(None),
                Vacancy.status.in_(CLOSED_STATUSES),
                Vacancy.status_changed_at >= prev_month,
                Vacancy.status_changed_at < this_month,
            )
        )
    ).scalar_one()

    hired_this = (
        await db.execute(
            select(func.count())
            .select_from(Candidate)
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.status == CandidateStatus.hired,
                Candidate.status_changed_at >= this_month,
            )
        )
    ).scalar_one()
    hired_prev = (
        await db.execute(
            select(func.count())
            .select_from(Candidate)
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.status == CandidateStatus.hired,
                Candidate.status_changed_at >= prev_month,
                Candidate.status_changed_at < this_month,
            )
        )
    ).scalar_one()

    return {
        "open_vacancies": int(open_now),
        "active_candidates": int(active_now),
        "closed_this_month": int(closed_this),
        "hired_this_month": int(hired_this),
        "delta": {
            "open_vacancies": _delta_pct(int(open_now), 0),  # без истории open снимка
            "active_candidates": _delta_pct(int(active_now), 0),
            "closed_this_month": _delta_pct(int(closed_this), int(closed_prev)),
            "hired_this_month": _delta_pct(int(hired_this), int(hired_prev)),
        },
    }


async def funnel(db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            select(Vacancy.status, func.count())
            .where(Vacancy.deleted_at.is_(None))
            .group_by(Vacancy.status)
        )
    ).all()
    counts = {s: c for s, c in rows}
    # возвращаем строго в порядке enum — фронту проще нарисовать воронку
    return [{"status": s.value, "count": int(counts.get(s, 0))} for s in VacancyStatus]


async def recruiter_load(db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            select(Candidate.recruiter_id, func.count())
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.archived.is_(False),
                Candidate.status.in_(ACTIVE_CANDIDATE_STATUSES),
            )
            .group_by(Candidate.recruiter_id)
            .order_by(func.count().desc())
        )
    ).all()
    return [{"recruiter_id": str(rid), "active_count": int(c)} for rid, c in rows]
