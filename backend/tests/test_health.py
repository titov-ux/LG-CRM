"""Дымовой тест: /healthz и /api/v1/openapi.json. Не требует БД/Redis."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_healthz() -> None:
    with TestClient(app) as c:
        r = c.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_openapi_loads() -> None:
    with TestClient(app) as c:
        r = c.get("/api/v1/openapi.json")
    assert r.status_code == 200
    body = r.json()
    assert body["info"]["title"] == "CRM ЛГ Интеграция API"
    # auth-эндпоинты на месте после Этапа 1
    assert "/api/v1/auth/login" in body["paths"]
    assert "/api/v1/auth/me" in body["paths"]
