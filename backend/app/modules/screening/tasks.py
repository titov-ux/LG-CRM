"""Celery / in-process постановка пост-анализа и retention аудио скрининга."""
from __future__ import annotations

import asyncio
import logging
import uuid

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_OUTBOX_KEY = "screening_analysis_outbox"
_OUTBOX_OFFLINE_KEY = "screening_offline_outbox"
# asyncio держит на задачи только слабые ссылки: без этого множества задачу
# пост-анализа может собрать GC, и сессия навсегда зависнет в processing.
_BACKGROUND_TASKS: set[asyncio.Task] = set()


def _spawn(loop: asyncio.AbstractEventLoop, sid: str, *, offline: bool = False) -> asyncio.Task:
    coro = _run_offline_then_analysis(sid) if offline else _run_analysis(sid)
    name = f"screening-offline-{sid}" if offline else f"screening-analysis-{sid}"
    task = loop.create_task(coro, name=name)
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return task


async def wait_for_pending_analysis(timeout: float = 30.0) -> None:
    """Дождаться незавершённых in-process анализов (eager-режим dev/tests)."""
    pending = [t for t in _BACKGROUND_TASKS if not t.done()]
    if not pending:
        return
    try:
        await asyncio.wait(pending, timeout=timeout)
    except Exception:  # noqa: BLE001
        logger.exception("screening.analysis: wait_for_pending failed")


def enqueue_screening_analysis(session, session_id: uuid.UUID) -> None:
    """Поставить анализ после коммита текущей ORM-сессии.

    `session` — sync-сессия SQLAlchemy (`db.sync_session` у AsyncSession).
    В outbox, чтобы не стартовать задачу до успешного commit (иначе worker
    увидит ещё live-статус).
    """
    session.info.setdefault(_OUTBOX_KEY, []).append(session_id)


def enqueue_screening_offline_transcribe(session, session_id: uuid.UUID) -> None:
    """Офлайн-STT из audio_file + затем пост-анализ (после commit)."""
    session.info.setdefault(_OUTBOX_OFFLINE_KEY, []).append(session_id)


@event.listens_for(Session, "after_commit")
def _flush_analysis_after_commit(session: Session) -> None:
    offline = session.info.pop(_OUTBOX_OFFLINE_KEY, None) or []
    pending = session.info.pop(_OUTBOX_KEY, None) or []
    # Офлайн уже включает анализ — не дублируем.
    offline_set = {str(x) for x in offline}
    for session_id in offline:
        _dispatch(session_id, offline=True)
    for session_id in pending:
        if str(session_id) in offline_set:
            continue
        _dispatch(session_id, offline=False)


@event.listens_for(Session, "after_rollback")
def _drop_analysis_after_rollback(session: Session) -> None:
    session.info.pop(_OUTBOX_KEY, None)
    session.info.pop(_OUTBOX_OFFLINE_KEY, None)


def _dispatch(session_id: uuid.UUID, *, offline: bool) -> None:
    settings = get_settings()
    sid = str(session_id)
    if settings.screening_analysis_eager:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning(
                "screening.%s: no event loop — running sync for %s",
                "offline" if offline else "analysis",
                sid,
            )
            asyncio.run(
                _run_offline_then_analysis(sid) if offline else _run_analysis(sid)
            )
            return
        _spawn(loop, sid, offline=offline)
        return
    try:
        if offline:
            offline_transcribe_screening.delay(sid)
        else:
            analyze_screening_session.delay(sid)
    except Exception:
        logger.exception(
            "screening.%s: Celery enqueue failed for %s — fallback inline",
            "offline" if offline else "analysis",
            sid,
        )
        try:
            loop = asyncio.get_running_loop()
            _spawn(loop, sid, offline=offline)
        except RuntimeError:
            asyncio.run(
                _run_offline_then_analysis(sid) if offline else _run_analysis(sid)
            )


async def _run_analysis(session_id: str) -> None:
    from app.modules.screening import service as screening_service

    try:
        await screening_service.run_post_analysis(uuid.UUID(session_id))
    except Exception:  # noqa: BLE001 — фоновая задача не должна ронять loop
        logger.exception("screening.analysis: failed for %s", session_id)


async def _run_offline_then_analysis(session_id: str) -> None:
    from app.modules.screening import service as screening_service

    sid = uuid.UUID(session_id)
    try:
        await screening_service.run_offline_transcription(sid)
    except Exception:  # noqa: BLE001
        logger.exception("screening.offline: failed for %s", session_id)
    try:
        await screening_service.run_post_analysis(sid, replace_report=True)
    except Exception:  # noqa: BLE001
        logger.exception("screening.analysis: failed after offline for %s", session_id)


@celery_app.task(name="screening.analyze_session", bind=True, max_retries=2)
def analyze_screening_session(self, session_id: str) -> str:
    """Celery-обёртка: async пост-анализ в отдельном event loop воркера."""
    try:
        asyncio.run(_run_analysis(session_id))
    except Exception as exc:  # noqa: BLE001
        logger.exception("screening.analyze_session task failed: %s", session_id)
        raise self.retry(exc=exc, countdown=15) from exc
    return session_id


@celery_app.task(name="screening.offline_transcribe", bind=True, max_retries=1)
def offline_transcribe_screening(self, session_id: str) -> str:
    """Офлайн-STT из S3-записи, затем пост-анализ отчёта."""
    try:
        asyncio.run(_run_offline_then_analysis(session_id))
    except Exception as exc:  # noqa: BLE001
        logger.exception("screening.offline_transcribe task failed: %s", session_id)
        raise self.retry(exc=exc, countdown=30) from exc
    return session_id


async def _run_purge() -> int:
    from app.db.session import SessionLocal
    from app.integrations.s3 import get_s3_adapter
    from app.modules.screening import service as screening_service

    async with SessionLocal() as db:
        return await screening_service.purge_expired_audio(db, get_s3_adapter())


@celery_app.task(name="screening.purge_expired_audio")
def purge_expired_audio_task() -> int:
    """Ежедневный retention: удалить аудио скрининга старше N дней."""
    settings = get_settings()
    if settings.screening_audio_retention_days <= 0:
        logger.info("screening.retention: disabled (SCREENING_AUDIO_RETENTION_DAYS=0)")
        return 0
    try:
        purged = asyncio.run(_run_purge())
    except Exception:
        logger.exception("screening.purge_expired_audio failed")
        raise
    logger.info("screening.retention: purged %d audio file(s)", purged)
    return purged


async def _run_sweeper() -> int:
    from app.modules.screening import service as screening_service

    return await screening_service.close_stale_sessions()


@celery_app.task(name="screening.close_stale_sessions")
def close_stale_sessions_task() -> int:
    """Закрыть live-сессии, у которых оборвался WS или вышло время (Этап 6)."""
    try:
        return asyncio.run(_run_sweeper())
    except Exception:
        logger.exception("screening.close_stale_sessions failed")
        raise


__all__ = [
    "analyze_screening_session",
    "close_stale_sessions_task",
    "enqueue_screening_analysis",
    "enqueue_screening_offline_transcribe",
    "offline_transcribe_screening",
    "purge_expired_audio_task",
    "wait_for_pending_analysis",
]
