"""FastAPI entrypoint.

На Этапе 0 модули подключены пустыми роутерами-заглушками; реальные эндпоинты
будут наполняться по этапам 1–7 плана перехода (см. План_перехода_на_API.docx).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings
from app.realtime.bus import get_bus
from app.realtime.events import current_client_id_var, publish_user_presence_event
from app.realtime.presence import start_sweeper, stop_sweeper

logger = logging.getLogger(__name__)


def _init_sentry(dsn: str, environment: str, traces_sample_rate: float) -> None:
    """Инициализация Sentry-SDK.

    Тихо пропускаем, если `sentry-sdk` не установлен — это не обязательный
    runtime-deps, ставим только в проде (см. `requirements-prod.txt`).
    """
    if not dsn:
        return
    try:
        import sentry_sdk  # type: ignore[import-not-found]
        from sentry_sdk.integrations.fastapi import FastApiIntegration  # type: ignore
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration  # type: ignore
    except ImportError:
        return
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        traces_sample_rate=traces_sample_rate,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        send_default_pii=False,
    )


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Жизненный цикл процесса: поднимаем фоновые задачи на startup,
    останавливаем на shutdown.

    Realtime-bus подписывается на Redis pub/sub один раз на воркер. Без
    этого события из других uvicorn-воркеров (`--workers > 1` в проде)
    не доходили бы до WebSocket-ов, прицепленных к этому воркеру.

    Presence-sweeper чистит протухшие WS-соединения в общем Redis-стор-е
    presence-а (см. app/realtime/presence.py). Запускается во всех воркерах —
    Lua-скрипты атомарны, конкуренция между воркерами безопасна и просто
    приводит к тому, что чистку выполнит тот, кто пришёл первым.
    """
    bus = get_bus()
    try:
        await bus.start_listener()
    except Exception:
        logger.exception("realtime: failed to start bus listener (continuing)")

    async def _on_user_offlined(user_id: str) -> None:
        # Sweeper зачистил все соединения юзера — публикуем offline всем
        # подписчикам (это будет получено фронтами через тот же realtime-bus).
        publish_user_presence_event(user_id=user_id, online=False)

    try:
        await start_sweeper(on_offline=_on_user_offlined)
    except Exception:
        logger.exception("presence: failed to start sweeper (continuing)")

    try:
        yield
    finally:
        try:
            await stop_sweeper()
        except Exception:
            logger.exception("presence: error while stopping sweeper")
        try:
            await bus.stop_listener()
        except Exception:
            logger.exception("realtime: error while stopping bus listener")


def create_app() -> FastAPI:
    settings = get_settings()
    _init_sentry(
        settings.sentry_dsn,
        settings.sentry_environment,
        settings.sentry_traces_sample_rate,
    )
    app = FastAPI(
        title="CRM ЛГ Интеграция API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Запросы из Chrome-расширения hh.ru приходят с Origin
        # `chrome-extension://<extension_id>`. Идентификатор расширения
        # меняется (dev vs Web Store), поэтому регексп вместо whitelist.
        # allow_credentials=True требует, чтобы Access-Control-Allow-Origin
        # эхоировал конкретный Origin — что middleware и делает в regex-режиме.
        allow_origin_regex=r"^chrome-extension://[a-zA-Z0-9]+$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    class _ClientIdMiddleware(BaseHTTPMiddleware):
        """Прокидывает X-Client-Id из запроса в contextvar, чтобы realtime-события
        могли пометить отправителя. Используется для echo-suppression на фронте.
        """

        async def dispatch(self, request: Request, call_next):  # type: ignore[override]
            client_id = request.headers.get("X-Client-Id", "")
            token = current_client_id_var.set(client_id)
            try:
                return await call_next(request)
            finally:
                current_client_id_var.reset(token)

    app.add_middleware(_ClientIdMiddleware)

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
