"""Celery-приложение CRM-LG.

Прод: `celery -A app.celery_app worker` + `beat` (см. infra/docker-compose.prod.yml,
profile `celery`). Задачи: пост-анализ скрининга (Этап 5), retention аудио (Этап 6).

Broker/backend — Redis (`REDIS_URL`). Задачи импортируются через `include`,
чтобы worker видел их без ручного автодискавера.
"""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

_settings = get_settings()

celery_app = Celery(
    "crm_lg",
    broker=str(_settings.redis_url),
    backend=str(_settings.redis_url),
    include=["app.modules.screening.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Не копим бесконечные результаты пост-анализа.
    result_expires=3600,
    task_track_started=True,
    # В тестах/dev без worker можно включить eager через settings
    # (см. enqueue в screening.tasks) — здесь флаг Celery не дублируем.
    beat_schedule={
        # Ежедневно 03:15 UTC — purge аудио скрининга старше retention.
        "screening-purge-expired-audio": {
            "task": "screening.purge_expired_audio",
            "schedule": crontab(hour=3, minute=15),
        },
        # Раз в минуту: добиваем live-сессии с оборванным WS и вышедшие за
        # SCREENING_MAX_DURATION_MIN (иначе висят live вечно, без отчёта).
        "screening-close-stale-sessions": {
            "task": "screening.close_stale_sessions",
            "schedule": crontab(minute="*"),
        },
    },
)

__all__ = ["celery_app"]
