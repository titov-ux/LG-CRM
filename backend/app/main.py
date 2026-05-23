"""FastAPI entrypoint.

На Этапе 0 модули подключены пустыми роутерами-заглушками; реальные эндпоинты
будут наполняться по этапам 1–7 плана перехода (см. План_перехода_на_API.docx).
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings


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
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
