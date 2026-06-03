"""Сервис учёта времени сотрудников (`work_sessions`).

Запись (вызывается из WS-эндпоинта и lifespan):
  * `open_session`  — на became_online (первый коннект юзера);
  * `touch`         — на каждый HB-цикл WS (продлевает last_heartbeat_at);
  * `close_session` — на became_offline (disconnect) или из sweeper (sweep);
  * `reconcile_stale_open_sessions` — на старте процесса, закрывает «повисшие».

Чтение (для эндпоинтов /analytics/worklog/*):
  * `summary`  — суммарное время и число сессий по сотрудникам за период;
  * `sessions` — сырые интервалы пользователя за период.

Все write-функции идемпотентны и НИКОГДА не бросают наружу: presence/WS не
должны падать из-за учёта времени (тот же принцип, что у presence.heartbeat).
Каждый вызов открывает собственную короткую сессию БД (`SessionLocal`), т.к.
хуки живут вне request-scope FastAPI.
"""
from __future__ import annotations

import contextlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

from sqlalchemy import (
    DateTime,
    Integer,
    and_,
    case,
    cast,
    func,
    literal,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.modules.analytics.worklog_models import WorkSession, WorkSessionEndReason
from app.modules.users.models import User

logger = logging.getLogger(__name__)


def _coerce_uuid(user_id: uuid.UUID | str) -> uuid.UUID | None:
    if isinstance(user_id, uuid.UUID):
        return user_id
    try:
        return uuid.UUID(str(user_id))
    except (ValueError, TypeError):
        return None


@contextlib.asynccontextmanager
async def _writable(db: AsyncSession | None) -> AsyncIterator[AsyncSession]:
    """Дать пишущую сессию.

    Хуки WS/lifespan живут вне request-scope, поэтому по умолчанию открываем
    собственную короткую `SessionLocal` и сами коммитим. Если сессию передали
    извне (тесты, либо вызов внутри уже открытой транзакции), используем её и
    коммитим в ней же — на rollback-обёртке теста это откатится.
    """
    if db is not None:
        yield db
        await db.commit()
        return
    async with SessionLocal() as own:
        yield own
        await own.commit()


# === Запись =================================================================


async def open_session(
    user_id: uuid.UUID | str, *, db: AsyncSession | None = None
) -> None:
    """Открыть рабочую сессию (became_online).

    INSERT ... ON CONFLICT DO NOTHING по частичному unique-индексу
    `uq_work_sessions_open` — если открытая сессия уже есть (гонка вкладок/
    воркеров), второй INSERT просто ничего не сделает.
    """
    uid = _coerce_uuid(user_id)
    if uid is None:
        return
    now = datetime.now(timezone.utc)
    try:
        async with _writable(db) as session:
            stmt = (
                pg_insert(WorkSession)
                .values(
                    user_id=uid,
                    started_at=now,
                    last_heartbeat_at=now,
                    ended_at=None,
                )
                .on_conflict_do_nothing(
                    index_elements=["user_id"],
                    index_where=WorkSession.ended_at.is_(None),
                )
            )
            await session.execute(stmt)
    except Exception:
        logger.exception("worklog: open_session failed for %s (continuing)", uid)


async def touch(
    user_id: uuid.UUID | str,
    *,
    at: datetime | None = None,
    db: AsyncSession | None = None,
) -> None:
    """Продлить last_heartbeat_at открытой сессии (HB-цикл WS).

    `at` позволяет задать момент явно (используется в тестах для эмуляции
    прошедшего времени без реального ожидания).
    """
    uid = _coerce_uuid(user_id)
    if uid is None:
        return
    now = at or datetime.now(timezone.utc)
    try:
        async with _writable(db) as session:
            await session.execute(
                update(WorkSession)
                .where(
                    WorkSession.user_id == uid,
                    WorkSession.ended_at.is_(None),
                )
                .values(last_heartbeat_at=now)
            )
    except Exception:
        logger.exception("worklog: touch failed for %s (continuing)", uid)


async def record_activity(
    user_id: uuid.UUID | str,
    *,
    now: datetime | None = None,
    max_gap_seconds: int = 90,
    db: AsyncSession | None = None,
) -> None:
    """Учесть сигнал активности (Этап 3): вкладка видима И есть взаимодействие.

    Прибавляет к `active_seconds` дельту `now − last_active_at` и двигает
    `last_active_at` вперёд. Ключевые свойства:

    * **Дедупликация вкладок.** Дельта всегда меряется от единого
      `last_active_at`, поэтому частые сигналы (несколько вкладок) дают мелкие
      дельты с той же суммой — двойного счёта нет.
    * **Кап на разрыв.** Если с прошлого сигнала прошло больше `max_gap_seconds`
      (юзер уходил/был idle — фронт не слал сигналы), интервал НЕ засчитываем,
      только переставляем якорь. Так «активным» считается лишь непрерывная
      активность.
    * Первый сигнал (last_active_at IS NULL) ничего не прибавляет — только
      ставит якорь.

    Время берём серверное (`func.now()`), клиентским часам не доверяем. `now`
    можно передать явно для детерминизма в тестах.
    """
    uid = _coerce_uuid(user_id)
    if uid is None:
        return
    now_expr = (
        func.now() if now is None else cast(literal(now), DateTime(timezone=True))
    )
    delta = func.extract("epoch", now_expr - WorkSession.last_active_at)
    increment = case(
        (
            and_(
                WorkSession.last_active_at.is_not(None),
                delta >= 0,
                delta <= max_gap_seconds,
            ),
            cast(func.floor(delta), Integer),
        ),
        else_=literal(0),
    )
    try:
        async with _writable(db) as session:
            await session.execute(
                update(WorkSession)
                .where(
                    WorkSession.user_id == uid,
                    WorkSession.ended_at.is_(None),
                )
                .values(
                    active_seconds=WorkSession.active_seconds + increment,
                    last_active_at=now_expr,
                )
            )
    except Exception:
        logger.exception("worklog: record_activity failed for %s (continuing)", uid)


async def close_session(
    user_id: uuid.UUID | str,
    *,
    reason: WorkSessionEndReason,
    use_heartbeat: bool = False,
    db: AsyncSession | None = None,
) -> None:
    """Закрыть открытую сессию пользователя.

    `use_heartbeat=False` (штатный disconnect) — закрываем «сейчас».
    `use_heartbeat=True`  (sweep/реконсиляция) — закрываем по
    `last_heartbeat_at`, чтобы не засчитать мёртвый TTL-хвост после падения
    воркера/сервера.

    `duration_seconds` считаем в том же UPDATE: extract(epoch, end − start).
    WHERE ended_at IS NULL делает повторный вызов безопасным no-op.
    """
    uid = _coerce_uuid(user_id)
    if uid is None:
        return
    end_ts = WorkSession.last_heartbeat_at if use_heartbeat else func.now()
    try:
        async with _writable(db) as session:
            await session.execute(
                update(WorkSession)
                .where(
                    WorkSession.user_id == uid,
                    WorkSession.ended_at.is_(None),
                )
                .values(
                    ended_at=end_ts,
                    end_reason=reason,
                    duration_seconds=cast(
                        func.extract("epoch", end_ts - WorkSession.started_at),
                        Integer,
                    ),
                )
            )
    except Exception:
        logger.exception("worklog: close_session failed for %s (continuing)", uid)


async def reconcile_stale_open_sessions(
    *, older_than: timedelta = timedelta(minutes=5), db: AsyncSession | None = None
) -> int:
    """Закрыть «повисшие» открытые сессии на старте процесса.

    Чинит случай, когда упал/перезапустился сам backend и ни disconnect, ни
    sweeper не отработали. Закрываем ТОЛЬКО устаревшие (last_heartbeat_at
    старше порога) — это безопасно для multi-worker: живые сессии других
    воркеров heartbeat-ятся часто (~30с) и под порог не попадут.

    Закрываем по last_heartbeat_at с reason=server_shutdown. Возвращает число
    закрытых сессий.
    """
    cutoff = datetime.now(timezone.utc) - older_than
    try:
        async with _writable(db) as session:
            result = await session.execute(
                update(WorkSession)
                .where(
                    WorkSession.ended_at.is_(None),
                    WorkSession.last_heartbeat_at < cutoff,
                )
                .values(
                    ended_at=WorkSession.last_heartbeat_at,
                    end_reason=WorkSessionEndReason.server_shutdown,
                    duration_seconds=cast(
                        func.extract(
                            "epoch",
                            WorkSession.last_heartbeat_at - WorkSession.started_at,
                        ),
                        Integer,
                    ),
                )
            )
            return result.rowcount or 0
    except Exception:
        logger.exception("worklog: reconcile_stale_open_sessions failed (continuing)")
        return 0


# === Чтение =================================================================


async def summary(
    db: AsyncSession,
    *,
    from_dt: datetime,
    to_dt: datetime,
    user_ids: list[uuid.UUID] | None = None,
) -> list[dict]:
    """Суммарное время и число сессий по сотрудникам за период `[from, to)`.

    Время считается как пересечение интервала сессии с окном запроса. Для
    ещё открытых сессий правая граница — `now()`. Это даёт корректную сумму,
    даже если сессия началась до окна или ещё не закрыта.
    """
    effective_end = func.coalesce(WorkSession.ended_at, func.now())
    overlap_start = func.greatest(WorkSession.started_at, from_dt)
    overlap_end = func.least(effective_end, to_dt)
    seconds = func.greatest(
        0, func.extract("epoch", overlap_end - overlap_start)
    )
    # Активное время — счётчик на всю сессию; чтобы корректно отнести его к
    # окну, пропорционируем по доле online-времени, попавшего в окно.
    full_online = func.greatest(
        1, func.extract("epoch", effective_end - WorkSession.started_at)
    )
    active_fraction = func.least(1.0, seconds / full_online)
    active_seconds = WorkSession.active_seconds * active_fraction

    conditions = [
        WorkSession.user_id.is_not(None),
        WorkSession.started_at < to_dt,
        effective_end > from_dt,
    ]
    if user_ids is not None:
        if not user_ids:
            return []
        conditions.append(WorkSession.user_id.in_(user_ids))

    stmt = (
        select(
            WorkSession.user_id.label("user_id"),
            User.full_name.label("full_name"),
            func.coalesce(func.sum(seconds), 0).label("total_seconds"),
            func.coalesce(func.sum(active_seconds), 0).label("total_active_seconds"),
            func.count().label("sessions_count"),
        )
        .join(User, User.id == WorkSession.user_id)
        .where(*conditions)
        .group_by(WorkSession.user_id, User.full_name)
        .order_by(func.sum(seconds).desc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "user_id": r.user_id,
            "full_name": r.full_name,
            "total_seconds": int(r.total_seconds or 0),
            "total_active_seconds": int(r.total_active_seconds or 0),
            "sessions_count": int(r.sessions_count or 0),
        }
        for r in rows
    ]


async def sessions(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
    limit: int = 500,
) -> list[WorkSession]:
    """Сырые интервалы пользователя, пересекающие окно `[from, to)`."""
    effective_end = func.coalesce(WorkSession.ended_at, func.now())
    stmt = (
        select(WorkSession)
        .where(
            WorkSession.user_id == user_id,
            WorkSession.started_at < to_dt,
            effective_end > from_dt,
        )
        .order_by(WorkSession.started_at.desc())
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())
