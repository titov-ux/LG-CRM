"""Сервис аналитики.

На MVP — простые SQL-агрегаты прямо по основным таблицам. На Этапе 8+ это
переедет в материализованные представления Postgres (см. план §4 Этап 7).

Все агрегаты, зависящие от времени, принимают окно `(from_dt, to_dt)`.
Окна — полуоткрытые [from, to). Сравнение (`compare`) рассчитывает второе
окно той же длины: `prev` — непосредственно перед основным; `yoy` —
смещение на год назад.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import and_, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditEntry
from app.modules.candidates.models import Candidate, CandidateStatus
from app.modules.clients.models import Client, ClientKind, ClientStatus
from app.modules.matching.models import MatchStatus, VacancyCandidate
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

CompareMode = Literal["prev", "yoy", "none"]
Granularity = Literal["auto", "day", "week", "month"]


# ---------------------------------------------------------------------------
# Period helpers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Period:
    """Полуоткрытое окно `[from_dt, to_dt)` в UTC."""

    from_dt: datetime
    to_dt: datetime

    @property
    def length(self) -> timedelta:
        return self.to_dt - self.from_dt


def _month_start(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def default_period() -> Period:
    """По умолчанию — текущий месяц (для обратной совместимости с прежним
    эндпоинтом /summary, который всегда считал «этот месяц»)."""
    now = datetime.now(timezone.utc)
    return Period(from_dt=_month_start(now), to_dt=now)


def resolve_period(from_dt: datetime | None, to_dt: datetime | None) -> Period:
    if from_dt is None and to_dt is None:
        return default_period()
    now = datetime.now(timezone.utc)
    f = _ensure_utc(from_dt) if from_dt else _month_start(now)
    t = _ensure_utc(to_dt) if to_dt else now
    if t <= f:
        # схлопнутый/инвертированный период — расширяем до 1 секунды,
        # чтобы запрос не падал (SQL `< from_dt`).
        t = f + timedelta(seconds=1)
    return Period(from_dt=f, to_dt=t)


def compare_period(period: Period, mode: CompareMode) -> Period | None:
    if mode == "none":
        return None
    if mode == "yoy":
        # тот же диапазон год назад
        try:
            f = period.from_dt.replace(year=period.from_dt.year - 1)
            t = period.to_dt.replace(year=period.to_dt.year - 1)
        except ValueError:
            # 29 февраля в невисокосном году — отодвигаем на день
            f = period.from_dt - timedelta(days=365)
            t = period.to_dt - timedelta(days=365)
        return Period(from_dt=f, to_dt=t)
    # prev — окно той же длины непосредственно перед периодом
    return Period(from_dt=period.from_dt - period.length, to_dt=period.from_dt)


def _delta_pct(curr: int | float, prev: int | float) -> float:
    if prev == 0:
        return 100.0 if curr > 0 else 0.0
    return round((curr - prev) * 100.0 / prev, 1)


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


async def _count_open_vacancies(db: AsyncSession) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(Vacancy)
                .where(
                    Vacancy.deleted_at.is_(None),
                    Vacancy.status.in_(OPEN_VACANCY_STATUSES),
                )
            )
        ).scalar_one()
    )


async def _count_active_candidates(db: AsyncSession) -> int:
    return int(
        (
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
    )


async def _count_closed_in_window(db: AsyncSession, period: Period) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(Vacancy)
                .where(
                    Vacancy.deleted_at.is_(None),
                    Vacancy.status.in_(CLOSED_STATUSES),
                    Vacancy.status_changed_at >= period.from_dt,
                    Vacancy.status_changed_at < period.to_dt,
                )
            )
        ).scalar_one()
    )


async def _count_hired_in_window(db: AsyncSession, period: Period) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(Candidate)
                .where(
                    Candidate.deleted_at.is_(None),
                    Candidate.status == CandidateStatus.hired,
                    Candidate.status_changed_at >= period.from_dt,
                    Candidate.status_changed_at < period.to_dt,
                )
            )
        ).scalar_one()
    )


async def summary(
    db: AsyncSession,
    *,
    period: Period | None = None,
    compare_mode: CompareMode = "prev",
) -> dict:
    """KPI за период с дельтами относительно сравниваемого окна.

    Поле `open_vacancies`/`active_candidates` — снимок на «сейчас» (исторических
    значений на даты в прошлом нет, пока не введём snapshot-таблицу). Поэтому
    дельты для них рассчитываются только при `compare_mode != none` И если
    период включает сейчас — иначе возвращаем 0 (нет, с чем сравнивать).
    """
    period = period or default_period()
    cmp = compare_period(period, compare_mode)

    open_now = await _count_open_vacancies(db)
    active_now = await _count_active_candidates(db)
    closed = await _count_closed_in_window(db, period)
    hired = await _count_hired_in_window(db, period)

    if cmp is not None:
        closed_prev = await _count_closed_in_window(db, cmp)
        hired_prev = await _count_hired_in_window(db, cmp)
    else:
        closed_prev = 0
        hired_prev = 0

    return {
        "open_vacancies": open_now,
        "active_candidates": active_now,
        # имена полей сохраняем (closedThisMonth / hiredThisMonth) для
        # совместимости фронта; смысл теперь — «за выбранный период».
        "closed_this_month": closed,
        "hired_this_month": hired,
        "delta": {
            "open_vacancies": 0.0,
            "active_candidates": 0.0,
            "closed_this_month": _delta_pct(closed, closed_prev) if cmp else 0.0,
            "hired_this_month": _delta_pct(hired, hired_prev) if cmp else 0.0,
        },
        "period": {
            "from": period.from_dt.isoformat(),
            "to": period.to_dt.isoformat(),
        },
        "compare": (
            {
                "mode": compare_mode,
                "from": cmp.from_dt.isoformat(),
                "to": cmp.to_dt.isoformat(),
            }
            if cmp
            else None
        ),
    }


# ---------------------------------------------------------------------------
# Funnel / recruiter load (без изменений — не зависят от периода)
# ---------------------------------------------------------------------------


async def funnel(db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            select(Vacancy.status, func.count())
            .where(Vacancy.deleted_at.is_(None))
            .group_by(Vacancy.status)
        )
    ).all()
    counts = {s: c for s, c in rows}
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


# ---------------------------------------------------------------------------
# Trends
# ---------------------------------------------------------------------------


def _resolve_granularity(period: Period, granularity: Granularity) -> Literal["day", "week", "month"]:
    if granularity != "auto":
        return granularity
    days = max(1, int(period.length.total_seconds() // 86400))
    if days <= 31:
        return "day"
    if days <= 180:
        return "week"
    return "month"


def _bucket_starts(period: Period, gran: Literal["day", "week", "month"]) -> list[datetime]:
    """Список начал бакетов внутри `period` (включая частичные на краях)."""
    starts: list[datetime] = []
    if gran == "day":
        cur = period.from_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        while cur < period.to_dt:
            starts.append(cur)
            cur = cur + timedelta(days=1)
    elif gran == "week":
        # ISO-неделя: начало — понедельник 00:00 UTC
        f = period.from_dt
        monday = (f - timedelta(days=f.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        cur = monday
        while cur < period.to_dt:
            starts.append(cur)
            cur = cur + timedelta(days=7)
    else:  # month
        cur = _month_start(period.from_dt)
        while cur < period.to_dt:
            starts.append(cur)
            year = cur.year + (1 if cur.month == 12 else 0)
            month = 1 if cur.month == 12 else cur.month + 1
            cur = cur.replace(year=year, month=month)
    return starts


async def _count_by_bucket(
    db: AsyncSession,
    *,
    table,
    ts_col,
    extra_filters: list,
    period: Period,
    gran: Literal["day", "week", "month"],
) -> dict[datetime, int]:
    """Группировка count(*) по дате-бакету (date_trunc)."""
    bucket = func.date_trunc(gran, ts_col)
    q = (
        select(bucket.label("b"), func.count().label("c"))
        .select_from(table)
        .where(ts_col >= period.from_dt, ts_col < period.to_dt, *extra_filters)
        .group_by(bucket)
    )
    rows = (await db.execute(q)).all()
    out: dict[datetime, int] = {}
    for b, c in rows:
        # date_trunc возвращает naive datetime — нормализуем в UTC
        b_utc = _ensure_utc(b)
        out[b_utc] = int(c)
    return out


# ---------------------------------------------------------------------------
# Funnel v2 — настоящая воронка по VacancyCandidate.status
# ---------------------------------------------------------------------------


# Линейный порядок стадий matching. Кандидат на стадии X считается достигшим
# всех предыдущих (предположение «без отката» — апстрим-движение из rejected
# в воронке не моделируется).
MATCH_STAGES: tuple[MatchStatus, ...] = (
    MatchStatus.submitted,
    MatchStatus.reviewed,
    MatchStatus.interview,
    MatchStatus.offered,
    MatchStatus.accepted,
)
MATCH_REJECTED: tuple[MatchStatus, ...] = (
    MatchStatus.rejected_client,
    MatchStatus.rejected_internal,
)


async def funnel_v2(db: AsyncSession, *, period: Period | None = None) -> dict:
    """Воронка по VacancyCandidate за период (по `added_at`).

    Для каждой стадии: count тех, чей status ≥ этой стадии (rejected
    идут отдельной веткой). Между соседними стадиями — conversion% и drop-off.
    """
    period = period or default_period()

    rows = (
        await db.execute(
            select(VacancyCandidate.status, func.count())
            .where(
                VacancyCandidate.added_at >= period.from_dt,
                VacancyCandidate.added_at < period.to_dt,
            )
            .group_by(VacancyCandidate.status)
        )
    ).all()
    by_status: dict[MatchStatus, int] = {s: int(c) for s, c in rows}

    # «Достигли стадии X» = count(статус ∈ {X, X+1, …, accepted})
    # Отказы не считаются достигшими — они «ушли вбок» и должны выпадать
    # из воронки начиная со стадии, на которой отвалились. Без аудит-лога
    # vacancy_candidate-статуса мы не знаем, на какой стадии случился reject,
    # поэтому возвращаем их отдельным числом, без распределения по стадиям.
    cumulative: list[int] = []
    for i, st in enumerate(MATCH_STAGES):
        cnt = sum(by_status.get(s, 0) for s in MATCH_STAGES[i:])
        cumulative.append(cnt)

    stages = []
    for i, st in enumerate(MATCH_STAGES):
        cnt = cumulative[i]
        if i == 0:
            conv = 100.0
            drop = 0
        else:
            prev = cumulative[i - 1]
            conv = round(cnt * 100.0 / prev, 1) if prev > 0 else 0.0
            drop = max(0, prev - cnt)
        stages.append(
            {
                "status": st.value,
                "count": cnt,
                "conversion_pct": conv,
                "drop_off": drop,
            }
        )

    rejected_client = by_status.get(MatchStatus.rejected_client, 0)
    rejected_internal = by_status.get(MatchStatus.rejected_internal, 0)
    total = sum(by_status.values())
    # «Overall» — из submitted в accepted. Если кто-то добавлен сразу выше
    # submitted (теоретически возможно), он всё равно вошёл в верх воронки.
    top = cumulative[0]
    bottom = cumulative[-1]
    overall_conv = round(bottom * 100.0 / top, 1) if top > 0 else 0.0

    return {
        "stages": stages,
        "rejected": {
            "client": rejected_client,
            "internal": rejected_internal,
            "total": rejected_client + rejected_internal,
        },
        "total": total,
        "overall_conversion_pct": overall_conv,
        "period": {
            "from": period.from_dt.isoformat(),
            "to": period.to_dt.isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# Time-to-hire
# ---------------------------------------------------------------------------


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    k = (len(values) - 1) * pct
    f = int(k)
    c = min(f + 1, len(values) - 1)
    if f == c:
        return float(values[f])
    return float(values[f] + (values[c] - values[f]) * (k - f))


async def time_to_hire(db: AsyncSession, *, period: Period | None = None) -> dict:
    """Скорость найма.

    Берём все наймы (candidate.status=hired) в окне `period` по
    `status_changed_at`. Для каждого нанятого ищем вакансии, к которым он
    был прикреплён через VacancyCandidate, и считаем `hired_at - vacancy.created_at`.
    Если кандидат был прикреплён к нескольким вакансиям — берём первую
    созданную (самая «старая» вакансия). Это не идеально, но без audit-лога
    конкретной «hired against vacancy X» — лучшее приближение.
    """
    period = period or default_period()

    # SQL: join Candidate (hired в окне) с VacancyCandidate и Vacancy
    rows = (
        await db.execute(
            select(
                Candidate.id,
                Candidate.status_changed_at,
                func.min(Vacancy.created_at).label("vac_created"),
            )
            .join(VacancyCandidate, VacancyCandidate.candidate_id == Candidate.id)
            .join(Vacancy, Vacancy.id == VacancyCandidate.vacancy_id)
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.status == CandidateStatus.hired,
                Candidate.status_changed_at >= period.from_dt,
                Candidate.status_changed_at < period.to_dt,
                Vacancy.deleted_at.is_(None),
            )
            .group_by(Candidate.id, Candidate.status_changed_at)
        )
    ).all()

    days_list: list[float] = []
    for _cid, hired_at, vac_created in rows:
        if hired_at and vac_created:
            delta = (hired_at - vac_created).total_seconds() / 86400.0
            if delta >= 0:
                days_list.append(delta)

    n = len(days_list)
    avg = round(sum(days_list) / n, 1) if n else 0.0
    median = round(_percentile(days_list, 0.5), 1)
    p90 = round(_percentile(days_list, 0.9), 1)

    # Распределение
    buckets = [
        {"label": "≤ 14 дней", "max_days": 14, "count": 0},
        {"label": "15–30 дней", "max_days": 30, "count": 0},
        {"label": "31–60 дней", "max_days": 60, "count": 0},
        {"label": "> 60 дней", "max_days": None, "count": 0},
    ]
    for d in days_list:
        if d <= 14:
            buckets[0]["count"] += 1
        elif d <= 30:
            buckets[1]["count"] += 1
        elif d <= 60:
            buckets[2]["count"] += 1
        else:
            buckets[3]["count"] += 1

    # Среднее время в стадии для кандидатов — по AuditEntry.
    # Берём все записи (entity_type=candidate, field=status), группируем по
    # entity_id, сортируем по created_at, считаем deltas.
    audit_rows = (
        await db.execute(
            select(
                AuditEntry.entity_id,
                AuditEntry.before,
                AuditEntry.after,
                AuditEntry.created_at,
            )
            .where(
                AuditEntry.entity_type == "candidate",
                AuditEntry.field == "status",
            )
            .order_by(AuditEntry.entity_id, AuditEntry.created_at)
        )
    ).all()

    # Для каждой стадии — суммарные дни и количество переходов «из неё»
    stage_totals: dict[str, list[float]] = {}
    prev_by_entity: dict[str, datetime] = {}
    prev_status_by_entity: dict[str, str] = {}
    for ent_id, before, after, created in audit_rows:
        key = str(ent_id)
        if key in prev_by_entity and key in prev_status_by_entity:
            prev_status = prev_status_by_entity[key]
            delta_days = (created - prev_by_entity[key]).total_seconds() / 86400.0
            if delta_days >= 0:
                stage_totals.setdefault(prev_status, []).append(delta_days)
        # before — это статус, в котором кандидат был ДО события, после — новый.
        # Время «в стадии before» = (этот created_at - предыдущий created_at).
        # Так что для следующего цикла фиксируем after как «следующий статус»
        # и created_at как «момент входа в after».
        prev_by_entity[key] = created
        prev_status_by_entity[key] = after or ""

    by_stage = [
        {
            "status": status,
            "avg_days": round(sum(vals) / len(vals), 1) if vals else 0.0,
            "median_days": round(_percentile(vals, 0.5), 1) if vals else 0.0,
            "sample": len(vals),
        }
        for status, vals in sorted(stage_totals.items())
    ]

    return {
        "sample_size": n,
        "avg_days": avg,
        "median_days": median,
        "p90_days": p90,
        "distribution": buckets,
        "by_stage": by_stage,
        "period": {
            "from": period.from_dt.isoformat(),
            "to": period.to_dt.isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# Attention / SLA
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Recruiter performance
# ---------------------------------------------------------------------------


# Сколько рабочих часов в месяце — для перевода Vacancy.rate_client (₽/час)
# в месячный поток для расчёта маржи.
WORKING_HOURS_PER_MONTH = 160


async def recruiter_performance(
    db: AsyncSession, *, period: Period | None = None
) -> dict:
    """Сводная таблица «по рекрутерам» за период.

    candidates_created — Candidate.created_at в period.
    presented — distinct кандидаты, переведённые в статус «presented» в period
      (по AuditEntry: entity_type=candidate, field=status, after=presented).
    hired — Candidate.status=hired и Candidate.status_changed_at в period.
    hire_rate = hired / presented (0, если presented=0).
    avg_time_to_hire — средние дни от Vacancy.created_at (самой ранней
      прикреплённой) до Candidate.status_changed_at для hired в period.
    total_margin — сумма (rate_client*160 − rate_month) по hired в period.
    sparkline — 8 равных недельных бакетов внутри `period`, hires per week.
    """
    from app.modules.users.models import Role, User as UserModel

    period = period or default_period()

    # 1) Список рекрутеров (recruiter + admin не считаем «рекрутерами»;
    #    для AM тоже не считаем — но если у кого-то есть кандидаты, добавим)
    recruiter_rows = (
        await db.execute(
            select(UserModel.id, UserModel.full_name).where(
                UserModel.role == Role.recruiter,
                UserModel.is_active.is_(True),
            )
        )
    ).all()
    recruiters: dict[str, dict] = {
        str(rid): {
            "recruiter_id": str(rid),
            "full_name": name,
            "candidates_created": 0,
            "presented": 0,
            "hired": 0,
            "hire_rate_pct": 0.0,
            "avg_time_to_hire_days": 0.0,
            "total_margin": 0.0,
            "sparkline": [],
        }
        for rid, name in recruiter_rows
    }

    def _ensure(rid: str | None) -> dict | None:
        if not rid:
            return None
        if rid not in recruiters:
            # рекрутер мог быть деактивирован, но у него есть исторические
            # кандидаты — всё равно покажем строку
            recruiters[rid] = {
                "recruiter_id": rid,
                "full_name": "(деактивирован)",
                "candidates_created": 0,
                "presented": 0,
                "hired": 0,
                "hire_rate_pct": 0.0,
                "avg_time_to_hire_days": 0.0,
                "total_margin": 0.0,
                "sparkline": [],
            }
        return recruiters[rid]

    # 2) candidates_created
    created_rows = (
        await db.execute(
            select(Candidate.recruiter_id, func.count())
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.created_at >= period.from_dt,
                Candidate.created_at < period.to_dt,
            )
            .group_by(Candidate.recruiter_id)
        )
    ).all()
    for rid, cnt in created_rows:
        row = _ensure(str(rid))
        if row is not None:
            row["candidates_created"] = int(cnt)

    # 3) presented — distinct entity_id по AuditEntry в окне.
    #    Привязка к рекрутеру — через текущего recruiter_id кандидата
    #    (history смены рекрутера в Audit есть, но «причина = тот, кто работает
    #    с кандидатом сейчас» — разумное приближение).
    presented_rows = (
        await db.execute(
            select(Candidate.recruiter_id, func.count(func.distinct(AuditEntry.entity_id)))
            .select_from(AuditEntry)
            .join(Candidate, Candidate.id == AuditEntry.entity_id)
            .where(
                AuditEntry.entity_type == "candidate",
                AuditEntry.field == "status",
                AuditEntry.after == CandidateStatus.presented.value,
                AuditEntry.created_at >= period.from_dt,
                AuditEntry.created_at < period.to_dt,
                Candidate.deleted_at.is_(None),
            )
            .group_by(Candidate.recruiter_id)
        )
    ).all()
    for rid, cnt in presented_rows:
        row = _ensure(str(rid))
        if row is not None:
            row["presented"] = int(cnt)

    # 4) hired
    hired_rows = (
        await db.execute(
            select(Candidate.recruiter_id, func.count())
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.status == CandidateStatus.hired,
                Candidate.status_changed_at >= period.from_dt,
                Candidate.status_changed_at < period.to_dt,
            )
            .group_by(Candidate.recruiter_id)
        )
    ).all()
    for rid, cnt in hired_rows:
        row = _ensure(str(rid))
        if row is not None:
            row["hired"] = int(cnt)

    # 5) hire_rate, total_margin, avg_time_to_hire — берём детальный список
    #    hired-кандидатов с прикреплённой самой ранней вакансией.
    hired_detail = (
        await db.execute(
            select(
                Candidate.recruiter_id,
                Candidate.id,
                Candidate.rate_month,
                Candidate.status_changed_at,
                func.min(Vacancy.created_at).label("vac_created"),
                func.max(Vacancy.rate_client).label("rate_client"),
            )
            .select_from(Candidate)
            .outerjoin(VacancyCandidate, VacancyCandidate.candidate_id == Candidate.id)
            .outerjoin(Vacancy, Vacancy.id == VacancyCandidate.vacancy_id)
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.status == CandidateStatus.hired,
                Candidate.status_changed_at >= period.from_dt,
                Candidate.status_changed_at < period.to_dt,
            )
            .group_by(
                Candidate.recruiter_id,
                Candidate.id,
                Candidate.rate_month,
                Candidate.status_changed_at,
            )
        )
    ).all()
    tth_by_rec: dict[str, list[float]] = {}
    for rid, _cid, rate_month, hired_at, vac_created, rate_client in hired_detail:
        key = str(rid)
        row = _ensure(key)
        if row is None:
            continue
        # маржа (если есть привязанная вакансия)
        if rate_client is not None and rate_month is not None:
            margin = float(rate_client) * WORKING_HOURS_PER_MONTH - float(rate_month)
            if margin > 0:
                row["total_margin"] += margin
        # time-to-hire
        if vac_created is not None and hired_at is not None:
            d = (hired_at - vac_created).total_seconds() / 86400.0
            if d >= 0:
                tth_by_rec.setdefault(key, []).append(d)

    for key, vals in tth_by_rec.items():
        if vals:
            recruiters[key]["avg_time_to_hire_days"] = round(sum(vals) / len(vals), 1)

    for row in recruiters.values():
        if row["presented"] > 0:
            row["hire_rate_pct"] = round(row["hired"] * 100.0 / row["presented"], 1)

    # 6) Sparkline — 8 равных бакетов внутри period, hires per bucket.
    n_buckets = 8
    span = period.length
    if span.total_seconds() <= 0:
        bucket_starts = [period.from_dt]
        n_buckets = 1
    else:
        step = span / n_buckets
        bucket_starts = [period.from_dt + step * i for i in range(n_buckets)]
    sparkline_rows = (
        await db.execute(
            select(
                Candidate.recruiter_id,
                Candidate.status_changed_at,
            )
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.status == CandidateStatus.hired,
                Candidate.status_changed_at >= period.from_dt,
                Candidate.status_changed_at < period.to_dt,
            )
        )
    ).all()
    # инициализируем
    for row in recruiters.values():
        row["sparkline"] = [0] * n_buckets
    for rid, hired_at in sparkline_rows:
        key = str(rid)
        if key not in recruiters:
            continue
        # ищем индекс бакета
        if n_buckets == 1:
            idx = 0
        else:
            elapsed = (hired_at - period.from_dt).total_seconds()
            total = span.total_seconds()
            idx = min(n_buckets - 1, max(0, int(elapsed / total * n_buckets)))
        recruiters[key]["sparkline"][idx] += 1

    # сортируем по hired desc, затем по hire_rate desc
    items = sorted(
        recruiters.values(),
        key=lambda r: (-r["hired"], -r["hire_rate_pct"], -r["candidates_created"]),
    )
    return {
        "items": items,
        "period": {
            "from": period.from_dt.isoformat(),
            "to": period.to_dt.isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# Client performance
# ---------------------------------------------------------------------------


# Порог «stale» — клиент без новых вакансий N+ дней
CLIENT_STALE_DAYS = 60
# Порог «high rejection» — доля отказов выше среднего по портфелю на этот коэф.
CLIENT_HIGH_REJECTION_RATIO = 1.5


async def client_performance(
    db: AsyncSession, *, period: Period | None = None
) -> dict:
    """Сводная таблица «по клиентам» за период.

    Каждый клиент с метриками:
    * vacancies_total / vacancies_open / vacancies_closed_in_period — счётчики.
    * hires_in_period — наймы (Candidate.status=hired в period) через
      VacancyCandidate→Vacancy.client_id.
    * avg_time_to_fill_days — для вакансий, закрытых в period
      (Vacancy.created_at → Vacancy.status_changed_at) с фильтром closed_success.
    * monthly_margin_run_rate — суммарная маржа в ₽/мес по hired в period
      (rate_client*160 − rate_month).
    * presented_to_hired_pct — конверсия по матчингам в period (added_at).
    * last_vacancy_at / days_since_last_vacancy — для индикатора «давно нет».
    * rejection_rate_pct — доля отказов среди всех матчингов клиента в period.
    * health_flags — список флагов: 'stale', 'high_rejection', 'no_open',
      'overdue' (хотя бы один просроченный дедлайн), 'no_hires_long' и т.п.
    * sparkline — вакансии созданные по 8 равным бакетам внутри period.
    """
    period = period or default_period()
    now = datetime.now(timezone.utc)

    # 1) Клиенты (только не удалённые)
    client_rows = (
        await db.execute(
            select(
                Client.id,
                Client.name,
                Client.industry,
                Client.status,
                Client.client_kind,
            ).where(Client.deleted_at.is_(None))
        )
    ).all()
    clients: dict[str, dict] = {
        str(cid): {
            "client_id": str(cid),
            "name": name,
            "industry": industry or "",
            "status": status.value if status else None,
            "client_kind": kind.value if kind else None,
            "vacancies_total": 0,
            "vacancies_open": 0,
            "vacancies_closed_in_period": 0,
            "hires_in_period": 0,
            "avg_time_to_fill_days": 0.0,
            "monthly_margin_run_rate": 0.0,
            "presented_to_hired_pct": 0.0,
            "last_vacancy_at": None,
            "days_since_last_vacancy": None,
            "rejection_rate_pct": 0.0,
            "health_flags": [],
            "sparkline": [0] * 8,
        }
        for cid, name, industry, status, kind in client_rows
    }

    if not clients:
        return {
            "items": [],
            "period": {
                "from": period.from_dt.isoformat(),
                "to": period.to_dt.isoformat(),
            },
        }

    # 2) vacancies_total (все, не удалённые)
    rows = (
        await db.execute(
            select(Vacancy.client_id, func.count())
            .where(Vacancy.deleted_at.is_(None))
            .group_by(Vacancy.client_id)
        )
    ).all()
    for cid, cnt in rows:
        if str(cid) in clients:
            clients[str(cid)]["vacancies_total"] = int(cnt)

    # vacancies_open — текущее состояние
    rows = (
        await db.execute(
            select(Vacancy.client_id, func.count())
            .where(
                Vacancy.deleted_at.is_(None),
                Vacancy.status.in_(OPEN_VACANCY_STATUSES),
            )
            .group_by(Vacancy.client_id)
        )
    ).all()
    for cid, cnt in rows:
        if str(cid) in clients:
            clients[str(cid)]["vacancies_open"] = int(cnt)

    # closed_in_period
    rows = (
        await db.execute(
            select(Vacancy.client_id, func.count())
            .where(
                Vacancy.deleted_at.is_(None),
                Vacancy.status.in_(CLOSED_STATUSES),
                Vacancy.status_changed_at >= period.from_dt,
                Vacancy.status_changed_at < period.to_dt,
            )
            .group_by(Vacancy.client_id)
        )
    ).all()
    for cid, cnt in rows:
        if str(cid) in clients:
            clients[str(cid)]["vacancies_closed_in_period"] = int(cnt)

    # last_vacancy_at
    rows = (
        await db.execute(
            select(Vacancy.client_id, func.max(Vacancy.created_at))
            .where(Vacancy.deleted_at.is_(None))
            .group_by(Vacancy.client_id)
        )
    ).all()
    for cid, last_at in rows:
        if str(cid) in clients and last_at is not None:
            clients[str(cid)]["last_vacancy_at"] = last_at.isoformat()
            clients[str(cid)]["days_since_last_vacancy"] = int(
                (now - last_at).total_seconds() // 86400
            )

    # 3) avg_time_to_fill для closed_success вакансий в period
    fill_rows = (
        await db.execute(
            select(
                Vacancy.client_id,
                Vacancy.created_at,
                Vacancy.status_changed_at,
            ).where(
                Vacancy.deleted_at.is_(None),
                Vacancy.status == VacancyStatus.closed_success,
                Vacancy.status_changed_at >= period.from_dt,
                Vacancy.status_changed_at < period.to_dt,
            )
        )
    ).all()
    fill_by_client: dict[str, list[float]] = {}
    for cid, created, closed in fill_rows:
        key = str(cid)
        if key in clients and created and closed:
            d = (closed - created).total_seconds() / 86400.0
            if d >= 0:
                fill_by_client.setdefault(key, []).append(d)
    for key, vals in fill_by_client.items():
        if vals:
            clients[key]["avg_time_to_fill_days"] = round(sum(vals) / len(vals), 1)

    # 4) hires_in_period и monthly_margin — через VacancyCandidate→Vacancy.client_id
    hire_rows = (
        await db.execute(
            select(
                Vacancy.client_id,
                Candidate.id,
                Candidate.rate_month,
                Vacancy.rate_client,
            )
            .select_from(Candidate)
            .join(VacancyCandidate, VacancyCandidate.candidate_id == Candidate.id)
            .join(Vacancy, Vacancy.id == VacancyCandidate.vacancy_id)
            .where(
                Candidate.deleted_at.is_(None),
                Candidate.status == CandidateStatus.hired,
                Candidate.status_changed_at >= period.from_dt,
                Candidate.status_changed_at < period.to_dt,
                Vacancy.deleted_at.is_(None),
            )
        )
    ).all()
    counted: set[tuple[str, str]] = set()  # (client_id, candidate_id) — не дублить hires при join
    for cid, cand_id, rate_month, rate_client in hire_rows:
        key = str(cid)
        if key not in clients:
            continue
        pair = (key, str(cand_id))
        if pair in counted:
            continue
        counted.add(pair)
        clients[key]["hires_in_period"] += 1
        if rate_client is not None and rate_month is not None:
            margin = float(rate_client) * WORKING_HOURS_PER_MONTH - float(rate_month)
            if margin > 0:
                clients[key]["monthly_margin_run_rate"] += margin

    # 5) Conversion presented→hired и rejection_rate по матчингам в period
    match_rows = (
        await db.execute(
            select(Vacancy.client_id, VacancyCandidate.status, func.count())
            .select_from(VacancyCandidate)
            .join(Vacancy, Vacancy.id == VacancyCandidate.vacancy_id)
            .where(
                Vacancy.deleted_at.is_(None),
                VacancyCandidate.added_at >= period.from_dt,
                VacancyCandidate.added_at < period.to_dt,
            )
            .group_by(Vacancy.client_id, VacancyCandidate.status)
        )
    ).all()
    by_client: dict[str, dict[str, int]] = {}
    for cid, st, cnt in match_rows:
        key = str(cid)
        if key in clients:
            by_client.setdefault(key, {})[st.value] = int(cnt)
    for key, statuses in by_client.items():
        total = sum(statuses.values())
        rejected = statuses.get("rejected_client", 0) + statuses.get(
            "rejected_internal", 0
        )
        # presented (или дальше) ↦ accepted
        presented_or_more = (
            statuses.get("submitted", 0)
            + statuses.get("reviewed", 0)
            + statuses.get("interview", 0)
            + statuses.get("offered", 0)
            + statuses.get("accepted", 0)
        )
        accepted = statuses.get("accepted", 0)
        if presented_or_more > 0:
            clients[key]["presented_to_hired_pct"] = round(
                accepted * 100.0 / presented_or_more, 1
            )
        if total > 0:
            clients[key]["rejection_rate_pct"] = round(rejected * 100.0 / total, 1)

    # 6) Sparkline — vacancies_created по 8 равным бакетам
    n_buckets = 8
    span = period.length
    if span.total_seconds() <= 0:
        bucket_starts = [period.from_dt]
        n_buckets = 1
    else:
        step = span / n_buckets
        bucket_starts = [period.from_dt + step * i for i in range(n_buckets)]
    for row in clients.values():
        row["sparkline"] = [0] * n_buckets

    spark_rows = (
        await db.execute(
            select(Vacancy.client_id, Vacancy.created_at).where(
                Vacancy.deleted_at.is_(None),
                Vacancy.created_at >= period.from_dt,
                Vacancy.created_at < period.to_dt,
            )
        )
    ).all()
    for cid, created in spark_rows:
        key = str(cid)
        if key not in clients:
            continue
        if n_buckets == 1:
            idx = 0
        else:
            elapsed = (created - period.from_dt).total_seconds()
            total_sec = span.total_seconds()
            idx = min(n_buckets - 1, max(0, int(elapsed / total_sec * n_buckets)))
        clients[key]["sparkline"][idx] += 1

    # 7) Health flags
    # Сначала — портфельная средняя по rejection_rate (без нулевых, чтобы
    # не «вытащить» порог к нулю)
    rates = [
        r["rejection_rate_pct"]
        for r in clients.values()
        if r["rejection_rate_pct"] > 0
    ]
    avg_rejection = sum(rates) / len(rates) if rates else 0.0
    rejection_threshold = max(20.0, avg_rejection * CLIENT_HIGH_REJECTION_RATIO)

    for row in clients.values():
        flags: list[str] = []
        if (
            row["days_since_last_vacancy"] is not None
            and row["days_since_last_vacancy"] >= CLIENT_STALE_DAYS
        ):
            flags.append("stale")
        if row["last_vacancy_at"] is None:
            flags.append("no_vacancies_ever")
        if (
            row["vacancies_open"] == 0
            and row["vacancies_total"] > 0
            and "stale" not in flags
        ):
            flags.append("no_open")
        if row["rejection_rate_pct"] >= rejection_threshold and rejection_threshold > 0:
            flags.append("high_rejection")
        row["health_flags"] = flags

    items = sorted(
        clients.values(),
        key=lambda r: (
            -r["hires_in_period"],
            -r["vacancies_open"],
            -r["vacancies_total"],
            r["name"].lower(),
        ),
    )
    return {
        "items": items,
        "period": {
            "from": period.from_dt.isoformat(),
            "to": period.to_dt.isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# Attention / SLA
# ---------------------------------------------------------------------------


async def attention(db: AsyncSession, *, top: int = 5) -> dict:
    """«Требует внимания» — снимок проблемных мест на сейчас."""
    now = datetime.now(timezone.utc)
    threshold_vac = now - timedelta(days=30)
    threshold_cand = now - timedelta(days=14)

    # 1) Вакансии «в работе» > 30 дней без смены статуса
    stuck_vac_q = (
        select(Vacancy.id, Vacancy.title, Vacancy.status, Vacancy.status_changed_at)
        .where(
            Vacancy.deleted_at.is_(None),
            Vacancy.status.in_(OPEN_VACANCY_STATUSES),
            Vacancy.status_changed_at < threshold_vac,
        )
        .order_by(Vacancy.status_changed_at)
    )
    stuck_vac_rows = (await db.execute(stuck_vac_q.limit(top))).all()
    stuck_vac_total = int(
        (
            await db.execute(
                select(func.count()).select_from(stuck_vac_q.subquery())
            )
        ).scalar_one()
    )
    stuck_vacancies = [
        {
            "id": str(vid),
            "title": title,
            "status": st.value,
            "days_in_status": int((now - changed).total_seconds() // 86400),
        }
        for vid, title, st, changed in stuck_vac_rows
    ]

    # 2) Кандидаты без движения > 14 дней
    stuck_cand_q = (
        select(
            Candidate.id,
            Candidate.full_name,
            Candidate.status,
            Candidate.status_changed_at,
        )
        .where(
            Candidate.deleted_at.is_(None),
            Candidate.archived.is_(False),
            Candidate.status.in_(ACTIVE_CANDIDATE_STATUSES),
            Candidate.status_changed_at < threshold_cand,
        )
        .order_by(Candidate.status_changed_at)
    )
    stuck_cand_rows = (await db.execute(stuck_cand_q.limit(top))).all()
    stuck_cand_total = int(
        (
            await db.execute(
                select(func.count()).select_from(stuck_cand_q.subquery())
            )
        ).scalar_one()
    )
    stuck_candidates = [
        {
            "id": str(cid),
            "full_name": name,
            "status": st.value,
            "days_in_status": int((now - changed).total_seconds() // 86400),
        }
        for cid, name, st, changed in stuck_cand_rows
    ]

    # 3) Открытые вакансии без прикреплённых кандидатов
    no_cand_q = (
        select(Vacancy.id, Vacancy.title, Vacancy.created_at)
        .where(
            Vacancy.deleted_at.is_(None),
            Vacancy.status.in_(OPEN_VACANCY_STATUSES),
            not_(
                select(VacancyCandidate.id)
                .where(VacancyCandidate.vacancy_id == Vacancy.id)
                .exists()
            ),
        )
        .order_by(Vacancy.created_at)
    )
    no_cand_rows = (await db.execute(no_cand_q.limit(top))).all()
    no_cand_total = int(
        (
            await db.execute(
                select(func.count()).select_from(no_cand_q.subquery())
            )
        ).scalar_one()
    )
    no_candidates = [
        {
            "id": str(vid),
            "title": title,
            "days_open": int((now - created).total_seconds() // 86400),
        }
        for vid, title, created in no_cand_rows
    ]

    # 4) Дедлайны
    today = now.date()
    in_7 = today + timedelta(days=7)
    in_14 = today + timedelta(days=14)

    overdue_q = (
        select(Vacancy.id, Vacancy.title, Vacancy.deadline)
        .where(
            Vacancy.deleted_at.is_(None),
            Vacancy.status.in_(OPEN_VACANCY_STATUSES),
            Vacancy.deadline.is_not(None),
            Vacancy.deadline < today,
        )
        .order_by(Vacancy.deadline)
    )
    overdue_rows = (await db.execute(overdue_q.limit(top))).all()
    overdue_total = int(
        (await db.execute(select(func.count()).select_from(overdue_q.subquery()))).scalar_one()
    )
    overdue = [
        {
            "id": str(vid),
            "title": title,
            "deadline": dl.isoformat() if dl else None,
            "days_overdue": (today - dl).days if dl else 0,
        }
        for vid, title, dl in overdue_rows
    ]

    soon_7_q = (
        select(Vacancy.id, Vacancy.title, Vacancy.deadline)
        .where(
            Vacancy.deleted_at.is_(None),
            Vacancy.status.in_(OPEN_VACANCY_STATUSES),
            Vacancy.deadline.is_not(None),
            Vacancy.deadline >= today,
            Vacancy.deadline <= in_7,
        )
        .order_by(Vacancy.deadline)
    )
    soon_7_rows = (await db.execute(soon_7_q.limit(top))).all()
    soon_7_total = int(
        (await db.execute(select(func.count()).select_from(soon_7_q.subquery()))).scalar_one()
    )
    deadlines_7 = [
        {
            "id": str(vid),
            "title": title,
            "deadline": dl.isoformat() if dl else None,
            "days_left": (dl - today).days if dl else 0,
        }
        for vid, title, dl in soon_7_rows
    ]

    soon_14_total = int(
        (
            await db.execute(
                select(func.count()).select_from(
                    select(Vacancy.id)
                    .where(
                        Vacancy.deleted_at.is_(None),
                        Vacancy.status.in_(OPEN_VACANCY_STATUSES),
                        Vacancy.deadline.is_not(None),
                        Vacancy.deadline > in_7,
                        Vacancy.deadline <= in_14,
                    )
                    .subquery()
                )
            )
        ).scalar_one()
    )

    return {
        "stuck_vacancies": {
            "total": stuck_vac_total,
            "threshold_days": 30,
            "items": stuck_vacancies,
        },
        "stuck_candidates": {
            "total": stuck_cand_total,
            "threshold_days": 14,
            "items": stuck_candidates,
        },
        "vacancies_without_candidates": {
            "total": no_cand_total,
            "items": no_candidates,
        },
        "overdue_deadlines": {
            "total": overdue_total,
            "items": overdue,
        },
        "deadlines_next_7_days": {
            "total": soon_7_total,
            "items": deadlines_7,
        },
        "deadlines_next_14_days": {
            "total": soon_14_total,
        },
    }


# ---------------------------------------------------------------------------


async def trends(
    db: AsyncSession,
    *,
    period: Period,
    granularity: Granularity = "auto",
) -> dict:
    gran = _resolve_granularity(period, granularity)
    buckets = _bucket_starts(period, gran)

    vac_created = await _count_by_bucket(
        db,
        table=Vacancy,
        ts_col=Vacancy.created_at,
        extra_filters=[Vacancy.deleted_at.is_(None)],
        period=period,
        gran=gran,
    )
    vac_closed = await _count_by_bucket(
        db,
        table=Vacancy,
        ts_col=Vacancy.status_changed_at,
        extra_filters=[
            Vacancy.deleted_at.is_(None),
            Vacancy.status.in_(CLOSED_STATUSES),
        ],
        period=period,
        gran=gran,
    )
    cand_created = await _count_by_bucket(
        db,
        table=Candidate,
        ts_col=Candidate.created_at,
        extra_filters=[Candidate.deleted_at.is_(None)],
        period=period,
        gran=gran,
    )
    hires = await _count_by_bucket(
        db,
        table=Candidate,
        ts_col=Candidate.status_changed_at,
        extra_filters=[
            Candidate.deleted_at.is_(None),
            Candidate.status == CandidateStatus.hired,
        ],
        period=period,
        gran=gran,
    )

    def _series(src: dict[datetime, int]) -> list[dict]:
        return [
            {"bucket": b.isoformat(), "value": src.get(b, 0)} for b in buckets
        ]

    return {
        "granularity": gran,
        "period": {
            "from": period.from_dt.isoformat(),
            "to": period.to_dt.isoformat(),
        },
        "series": {
            "vacancies_created": _series(vac_created),
            "vacancies_closed": _series(vac_closed),
            "candidates_created": _series(cand_created),
            "hires": _series(hires),
        },
    }
