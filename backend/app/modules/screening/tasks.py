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


def enqueue_screening_analysis(session, session_id: uuid.UUID) -> None:
    """Поставить анализ после коммита текущей ORM-сессии.

    `session` — sync-сессия SQLAlchemy (`db.sync_session` у AsyncSession).
    В outbox, чтобы не стартовать задачу до успешного commit (иначе worker
    увидит ещё live-статус).
    """
    session.info.setdefault(_OUTBOX_KEY, []).append(session_id)


@event.listens_for(Session, "after_commit")
def _flush_analysis_after_commit(session: Session) -> None:
    pending = session.info.pop(_OUTBOX_KEY, None)
    if not pending:
        return
    for session_id in pending:
        _dispatch(session_id)


@event.listens_for(Session, "after_rollback")
def _drop_analysis_after_rollback(session: Session) -> None:
    session.info.pop(_OUTBOX_KEY, None)


def _dispatch(session_id: uuid.UUID) -> None:
    settings = get_settings()
    sid = str(session_id)
    if settings.screening_analysis_eager:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning(
                "screening.analysis: no event loop — running sync for %s", sid
            )
            asyncio.run(_run_analysis(sid))
            return
        loop.create_task(_run_analysis(sid), name=f"screening-analysis-{sid}")
        return
    try:
        analyze_screening_session.delay(sid)
    except Exception:
        logger.exception(
            "screening.analysis: Celery enqueue failed for %s — fallback inline",
            sid,
        )
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_run_analysis(sid), name=f"screening-analysis-{sid}")
        except RuntimeError:
            asyncio.run(_run_analysis(sid))


async def _run_analysis(session_id: str) -> None:
    from app.modules.screening import service as screening_service

    try:
        await screening_service.run_post_analysis(uuid.UUID(session_id))
    except Exception:  # noqa: BLE001 — фоновая задача не должна ронять loop
        logger.exception("screening.analysis: failed for %s", session_id)


@celery_app.task(name="screening.analyze_session", bind=True, max_retries=2)
def analyze_screening_session(self, session_id: str) -> str:
    """Celery-обёртка: async пост-анализ в отдельном event loop воркера."""
    try:
        asyncio.run(_run_analysis(session_id))
    except Exception as exc:  # noqa: BLE001
        logger.exception("screening.analyze_session task failed: %s", session_id)
        raise self.retry(exc=exc, countdown=15) from exc
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


__all__ = [
    "analyze_screening_session",
    "enqueue_screening_analysis",
    "purge_expired_audio_task",
]
