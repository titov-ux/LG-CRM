"""Celery / in-process постановка пост-анализа и retention аудио скрининга."""
from __future__ import annotations

import asyncio
import logging
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from functools import partial

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
# `.delay()` — синхронный сокет к Redis, а зовём мы его из after_commit, т.е.
# изнутри `await db.commit()` в event loop: медленный/недоступный брокер
# замораживал весь воркер uvicorn на таймаут коннекта. Отправляем из потока.
_ENQUEUE_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="screening-enqueue")


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
    # Офлайн уже включает анализ — не дублируем. Дедуп по id: один commit
    # мог несколько раз вызвать enqueue (GET+finish) и породить N задач.
    seen_offline: set[str] = set()
    for session_id in offline:
        key = str(session_id)
        if key in seen_offline:
            continue
        seen_offline.add(key)
        _dispatch(session_id, offline=True)
    seen_pending: set[str] = set()
    for session_id in pending:
        key = str(session_id)
        if key in seen_offline or key in seen_pending:
            continue
        seen_pending.add(key)
        _dispatch(session_id, offline=False)


@event.listens_for(Session, "after_rollback")
def _drop_analysis_after_rollback(session: Session) -> None:
    session.info.pop(_OUTBOX_KEY, None)
    session.info.pop(_OUTBOX_OFFLINE_KEY, None)


def _send_to_broker(sid: str, *, offline: bool) -> None:
    """Собственно `.delay()` — только он ходит в Redis (см. `_ENQUEUE_POOL`)."""
    if offline:
        offline_transcribe_screening.delay(sid)
    else:
        analyze_screening_session.delay(sid)


def _run_inline(sid: str, *, offline: bool) -> None:
    """Фолбэк без брокера: гоняем анализ прямо здесь (dev / сбой Celery)."""
    asyncio.run(_run_offline_then_analysis(sid) if offline else _run_analysis(sid))


def _dispatch(session_id: uuid.UUID, *, offline: bool) -> None:
    settings = get_settings()
    sid = str(session_id)
    kind = "offline" if offline else "analysis"
    try:
        loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if settings.screening_analysis_eager:
        if loop is None:
            logger.warning("screening.%s: no event loop — running sync for %s", kind, sid)
            _run_inline(sid, offline=offline)
            return
        _spawn(loop, sid, offline=offline)
        return

    if loop is None:
        # Вне event loop (Celery-воркер, скрипты) блокирующий .delay() безопасен.
        try:
            _send_to_broker(sid, offline=offline)
        except Exception:
            logger.exception(
                "screening.%s: Celery enqueue failed for %s — fallback inline",
                kind,
                sid,
            )
            _run_inline(sid, offline=offline)
        return

    # Мы внутри `await db.commit()`: отдаём отправку в пул потоков, а ошибку
    # брокера разбираем колбэком — контракт outbox/дедупа не меняется, задача
    # по-прежнему ставится ровно один раз на commit.
    future: Future = _ENQUEUE_POOL.submit(_send_to_broker, sid, offline=offline)
    future.add_done_callback(
        partial(_on_enqueue_done, loop=loop, sid=sid, offline=offline, kind=kind)
    )


def _on_enqueue_done(
    future: Future,
    *,
    loop: asyncio.AbstractEventLoop,
    sid: str,
    offline: bool,
    kind: str,
) -> None:
    if future.cancelled() or future.exception() is None:
        return
    logger.error(
        "screening.%s: Celery enqueue failed for %s — fallback inline",
        kind,
        sid,
        exc_info=future.exception(),
    )
    try:
        # Колбэк выполняется в потоке пула — на loop возвращаемся аккуратно.
        loop.call_soon_threadsafe(partial(_spawn, loop, sid, offline=offline))
    except RuntimeError:
        # Loop уже закрыт (шатдаун процесса) — сессию добьёт уборщик
        # `screening.close_stale_sessions` по processing-таймауту.
        logger.error(
            "screening.%s: event loop closed, %s left for the sweeper", kind, sid
        )


# Ожидаемые «мягкие» сбои (нет STT_URL, S3/STT недоступны, AI отвалился) уже
# свёрнуты внутри сервиса: run_offline_transcription отдаёт 0, run_post_analysis
# пишет fallback-отчёт или сам ставит status=error. Сюда долетает только
# неожиданное (БД, сериализация, баг) — такое имеет смысл ретраить, поэтому в
# Celery-обёртках зовём с raise_errors=True. Для in-process (eager) режима
# оставляем прежнее поведение: фоновая задача не должна ронять event loop.
async def _run_analysis(session_id: str, *, raise_errors: bool = False) -> None:
    from app.modules.screening import service as screening_service

    try:
        await screening_service.run_post_analysis(uuid.UUID(session_id))
    except Exception:  # noqa: BLE001 — фоновая задача не должна ронять loop
        logger.exception("screening.analysis: failed for %s", session_id)
        if raise_errors:
            raise


async def _run_offline_then_analysis(
    session_id: str, *, raise_errors: bool = False
) -> None:
    from app.modules.screening import service as screening_service

    sid = uuid.UUID(session_id)
    wrote = 0
    try:
        wrote = await screening_service.run_offline_transcription(sid)
    except Exception:  # noqa: BLE001
        logger.exception("screening.offline: failed for %s", session_id)
    try:
        # Новые сегменты → пересобрать отчёт. Иначе обычный идемпотентный
        # анализ (без повторного notify, если отчёт уже был).
        await screening_service.run_post_analysis(
            sid, replace_report=bool(wrote and wrote > 0)
        )
    except Exception:  # noqa: BLE001
        logger.exception("screening.analysis: failed after offline for %s", session_id)
        # Ретраим ТОЛЬКО провал анализа: если STT упал, а отчёт всё-таки
        # собрался (сессия уже done), повтор заново качал бы запись, гонял
        # Whisper и LLM — двойной счёт за уже сделанную работу.
        if raise_errors:
            raise


@celery_app.task(name="screening.analyze_session", bind=True, max_retries=2)
def analyze_screening_session(self, session_id: str) -> str:
    """Celery-обёртка: async пост-анализ в отдельном event loop воркера."""
    try:
        asyncio.run(_run_analysis(session_id, raise_errors=True))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "screening.analyze_session task failed: %s — retry", session_id
        )
        raise self.retry(exc=exc, countdown=15) from exc
    return session_id


@celery_app.task(name="screening.offline_transcribe", bind=True, max_retries=1)
def offline_transcribe_screening(self, session_id: str) -> str:
    """Офлайн-STT из S3-записи, затем пост-анализ отчёта."""
    try:
        asyncio.run(_run_offline_then_analysis(session_id, raise_errors=True))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "screening.offline_transcribe task failed: %s — retry", session_id
        )
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
