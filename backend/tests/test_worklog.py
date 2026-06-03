"""Тесты учёта рабочего времени (`work_sessions`).

Проверяем сервис записи (open/touch/close/reconcile) и агрегацию summary.
Главные инварианты:
* открытие идемпотентно — не больше одной открытой сессии на юзера;
* close по heartbeat НЕ засчитывает мёртвый TTL-хвост (sweep/реконсиляция);
* close по disconnect закрывает «сейчас»;
* реконсиляция трогает только устаревшие открытые сессии;
* summary считает пересечение интервала с окном (клиппинг по краям).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.modules.analytics import worklog_service
from app.modules.analytics.worklog_models import WorkSession, WorkSessionEndReason
from tests.conftest import auth_headers


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _seed(
    db,
    user_id,
    *,
    started_at,
    last_heartbeat_at,
    ended_at=None,
    active_seconds=0,
    last_active_at=None,
):
    row = WorkSession(
        user_id=user_id,
        started_at=started_at,
        last_heartbeat_at=last_heartbeat_at,
        ended_at=ended_at,
        active_seconds=active_seconds,
        last_active_at=last_active_at,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def _open_count(db, user_id) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(WorkSession)
            .where(
                WorkSession.user_id == user_id,
                WorkSession.ended_at.is_(None),
            )
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_open_session_is_idempotent(db, recruiter_user) -> None:
    await worklog_service.open_session(recruiter_user.id, db=db)
    await worklog_service.open_session(recruiter_user.id, db=db)
    # Частичный unique-индекс + ON CONFLICT DO NOTHING → ровно одна открытая.
    assert await _open_count(db, recruiter_user.id) == 1


@pytest.mark.asyncio
async def test_open_session_resumes_recent_session(db, recruiter_user) -> None:
    now = _utcnow()
    # Сессия закрылась 30с назад (реконнект-шторм / сетевой блип), с активом.
    await _seed(
        db,
        recruiter_user.id,
        started_at=now - timedelta(minutes=10),
        last_heartbeat_at=now - timedelta(seconds=30),
        ended_at=now - timedelta(seconds=30),
        active_seconds=120,
    )
    await worklog_service.open_session(recruiter_user.id, db=db)

    rows = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalars().all()
    # Новой строки не появилось — реанимировали прошлую.
    assert len(rows) == 1
    assert rows[0].ended_at is None
    # Накопленное активное время сохранилось.
    assert rows[0].active_seconds == 120


@pytest.mark.asyncio
async def test_open_session_new_after_grace(db, recruiter_user) -> None:
    now = _utcnow()
    # Прошлая сессия закрылась давно (5 минут > grace 120с) — это новый заход.
    await _seed(
        db,
        recruiter_user.id,
        started_at=now - timedelta(hours=2),
        last_heartbeat_at=now - timedelta(minutes=5),
        ended_at=now - timedelta(minutes=5),
        active_seconds=300,
    )
    await worklog_service.open_session(recruiter_user.id, db=db)

    rows = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalars().all()
    # Прошлая осталась закрытой + создана новая открытая.
    assert len(rows) == 2
    assert await _open_count(db, recruiter_user.id) == 1


@pytest.mark.asyncio
async def test_touch_updates_heartbeat(db, recruiter_user) -> None:
    await worklog_service.open_session(recruiter_user.id, db=db)
    later = _utcnow() + timedelta(minutes=3)
    await worklog_service.touch(recruiter_user.id, at=later, db=db)

    row = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalar_one()
    assert abs((row.last_heartbeat_at - later).total_seconds()) < 1


@pytest.mark.asyncio
async def test_close_disconnect_uses_now(db, recruiter_user) -> None:
    start = _utcnow() - timedelta(seconds=300)
    await _seed(db, recruiter_user.id, started_at=start, last_heartbeat_at=start)

    await worklog_service.close_session(
        recruiter_user.id, reason=WorkSessionEndReason.disconnect, db=db
    )

    row = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalar_one()
    assert row.ended_at is not None
    assert row.end_reason == WorkSessionEndReason.disconnect
    # Закрыто «сейчас» → длительность ≈ время с момента старта (≥ ~295с).
    assert row.duration_seconds >= 295


@pytest.mark.asyncio
async def test_close_by_heartbeat_excludes_dead_tail(db, recruiter_user) -> None:
    # Юзер реально работал 600с, потом воркер упал; presence-TTL «висел» ещё
    # долго. Закрытие по last_heartbeat_at должно дать ровно 600с, без хвоста.
    start = _utcnow() - timedelta(hours=2)
    hb = start + timedelta(seconds=600)
    await _seed(db, recruiter_user.id, started_at=start, last_heartbeat_at=hb)

    await worklog_service.close_session(
        recruiter_user.id,
        reason=WorkSessionEndReason.sweep,
        use_heartbeat=True,
        db=db,
    )

    row = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalar_one()
    assert row.end_reason == WorkSessionEndReason.sweep
    assert abs((row.ended_at - hb).total_seconds()) < 1
    assert row.duration_seconds == 600


@pytest.mark.asyncio
async def test_reconcile_closes_only_stale(db, recruiter_user, admin_user) -> None:
    now = _utcnow()
    # Устаревшая открытая сессия (heartbeat 10 минут назад).
    await _seed(
        db,
        recruiter_user.id,
        started_at=now - timedelta(minutes=20),
        last_heartbeat_at=now - timedelta(minutes=10),
    )
    # Живая открытая сессия другого «воркера» (свежий heartbeat).
    await _seed(
        db,
        admin_user.id,
        started_at=now - timedelta(minutes=2),
        last_heartbeat_at=now,
    )

    closed = await worklog_service.reconcile_stale_open_sessions(
        older_than=timedelta(minutes=5), db=db
    )
    assert closed == 1

    stale = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalar_one()
    assert stale.ended_at is not None
    assert stale.end_reason == WorkSessionEndReason.server_shutdown

    # Живую сессию не тронули.
    assert await _open_count(db, admin_user.id) == 1


@pytest.mark.asyncio
async def test_record_activity_first_signal_only_anchors(db, recruiter_user) -> None:
    # Открытая сессия без активности: last_active_at IS NULL.
    await _seed(
        db,
        recruiter_user.id,
        started_at=_utcnow() - timedelta(minutes=5),
        last_heartbeat_at=_utcnow(),
    )
    t0 = _utcnow()
    await worklog_service.record_activity(recruiter_user.id, now=t0, db=db)

    row = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalar_one()
    # Первый сигнал не прибавляет, только ставит якорь.
    assert row.active_seconds == 0
    assert abs((row.last_active_at - t0).total_seconds()) < 1


@pytest.mark.asyncio
async def test_record_activity_accumulates_continuous(db, recruiter_user) -> None:
    t0 = _utcnow()
    await _seed(
        db,
        recruiter_user.id,
        started_at=t0 - timedelta(minutes=10),
        last_heartbeat_at=t0,
        last_active_at=t0,
    )
    # Непрерывная активность: +30с, затем ещё +30с.
    await worklog_service.record_activity(
        recruiter_user.id, now=t0 + timedelta(seconds=30), db=db
    )
    await worklog_service.record_activity(
        recruiter_user.id, now=t0 + timedelta(seconds=60), db=db
    )

    row = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalar_one()
    assert row.active_seconds == 60


@pytest.mark.asyncio
async def test_record_activity_skips_long_gap(db, recruiter_user) -> None:
    t0 = _utcnow()
    await _seed(
        db,
        recruiter_user.id,
        started_at=t0 - timedelta(hours=1),
        last_heartbeat_at=t0,
        last_active_at=t0,
    )
    # Разрыв 10 минут (> max_gap=90с) — был idle/ушёл. Интервал не считаем,
    # только переставляем якорь.
    await worklog_service.record_activity(
        recruiter_user.id, now=t0 + timedelta(minutes=10), db=db
    )
    row = (
        await db.execute(
            select(WorkSession).where(WorkSession.user_id == recruiter_user.id)
        )
    ).scalar_one()
    assert row.active_seconds == 0
    assert abs((row.last_active_at - (t0 + timedelta(minutes=10))).total_seconds()) < 1


# === Доступ к эндпоинтам: только администраторы ============================


def test_worklog_endpoints_admin_only(
    client, admin_user, account_manager_user, recruiter_user
) -> None:
    # admin — 200
    r = client.get(
        "/api/v1/analytics/worklog/summary",
        headers=auth_headers(client, "admin@lg.ru"),
    )
    assert r.status_code == 200, r.text

    # account_manager и recruiter — 403 на обоих эндпоинтах
    for email in ("am@lg.ru", "rec@lg.ru"):
        headers = auth_headers(client, email)
        assert (
            client.get(
                "/api/v1/analytics/worklog/summary", headers=headers
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/api/v1/analytics/worklog/sessions", headers=headers
            ).status_code
            == 403
        )


@pytest.mark.asyncio
async def test_summary_sums_and_clips_to_window(db, recruiter_user) -> None:
    base = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    window_from = base
    window_to = base + timedelta(hours=10)

    # Полностью внутри окна: 1 час online, 1800с активного → доля 1.0.
    await _seed(
        db,
        recruiter_user.id,
        started_at=base + timedelta(hours=1),
        last_heartbeat_at=base + timedelta(hours=2),
        ended_at=base + timedelta(hours=2),
        active_seconds=1800,
    )
    # Начался ДО окна, кончился внутри: online 60 мин, в окне 30 мин (доля 0.5).
    # active_seconds=600 → в окно прорактится 300.
    await _seed(
        db,
        recruiter_user.id,
        started_at=base - timedelta(minutes=30),
        last_heartbeat_at=base + timedelta(minutes=30),
        ended_at=base + timedelta(minutes=30),
        active_seconds=600,
    )

    rows = await worklog_service.summary(
        db,
        from_dt=window_from,
        to_dt=window_to,
        user_ids=[recruiter_user.id],
    )
    assert len(rows) == 1
    item = rows[0]
    assert item["user_id"] == recruiter_user.id
    assert item["sessions_count"] == 2
    # 3600 (внутри) + 1800 (клиппнутый хвост) = 5400.
    assert item["total_seconds"] == 5400
    # 1800 (доля 1.0) + 300 (600 × 0.5) = 2100.
    assert item["total_active_seconds"] == 2100
