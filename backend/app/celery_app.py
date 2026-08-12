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
    # ack после выполнения + возврат в очередь при падении воркера: задача
    # пост-анализа единственная, кто выводит сессию из processing. При
    # ack_early убитый OOM-ом воркер терял её молча, и сессия висела вечно.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Задачи длинные и неравномерные (офлайн-STT минуты); без этого воркер
    # разбирает пачку задач себе в буфер, и они ждут за самой долгой.
    worker_prefetch_multiplier=1,
    # Офлайн-STT целого часового интервью — единицы минут, но на холодной
    # модели/большой записи доходит до получаса. soft бросает
    # SoftTimeLimitExceeded (задача успеет упасть штатно и уйти в retry),
    # hard — страховка от зависшего сокета к STT/S3.
    # SCREENING_PROCESSING_TIMEOUT_MIN обязан быть больше hard-лимита, иначе
    # уборщик залипших processing начнёт дублировать ещё живые задачи.
    task_soft_time_limit=30 * 60,
    task_time_limit=35 * 60,
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
