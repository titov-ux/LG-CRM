"""Тесты /permissions-matrix."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def test_list_requires_auth(client: TestClient) -> None:
    r = client.get("/api/v1/permissions-matrix")
    assert r.status_code == 401


def test_recruiter_can_read_matrix(client: TestClient, admin_user, recruiter_user) -> None:
    """Любой авторизованный читает матрицу — нужна фронту для `can(...)`."""
    h = auth_headers(client, recruiter_user.email)
    r = client.get("/api/v1/permissions-matrix", headers=h)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 14  # 14 строк дефолта
    ids = {p["id"] for p in items}
    assert "users.manage" in ids
    assert "candidates.delete_permanent" in ids


def test_only_admin_can_update_row(client: TestClient, admin_user, recruiter_user) -> None:
    rec_h = auth_headers(client, recruiter_user.email)
    r = client.put(
        "/api/v1/permissions-matrix/clients.view",
        headers=rec_h,
        json={"matrix": {"viewer": False}},
    )
    assert r.status_code == 403


def test_admin_updates_row(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    # apply override
    r = client.put(
        "/api/v1/permissions-matrix/audit.view",
        headers=h,
        json={"matrix": {"account_manager": True}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == "audit.view"
    # admin остаётся true, account_manager — true (поменяли), recruiter/viewer — false (как было)
    assert body["matrix"]["admin"] is True
    assert body["matrix"]["account_manager"] is True
    assert body["matrix"]["recruiter"] is False

    # переоткроем матрицу — наш override должен сохраниться
    r = client.get("/api/v1/permissions-matrix", headers=h)
    row = next(p for p in r.json()["items"] if p["id"] == "audit.view")
    assert row["matrix"]["account_manager"] is True


def test_update_unknown_row_404(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.put(
        "/api/v1/permissions-matrix/no.such.row",
        headers=h,
        json={"matrix": {"admin": True}},
    )
    assert r.status_code == 404


def test_update_unknown_role_422(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.put(
        "/api/v1/permissions-matrix/clients.view",
        headers=h,
        json={"matrix": {"superhero": True}},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "unknown_role"


def test_reset_restores_defaults(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    # Сначала поменяем строку.
    client.put(
        "/api/v1/permissions-matrix/audit.view",
        headers=h,
        json={"matrix": {"account_manager": True}},
    )
    # reset
    r = client.post("/api/v1/permissions-matrix/reset", headers=h)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    row = next(p for p in items if p["id"] == "audit.view")
    # audit.view по дефолту — только admin
    assert row["matrix"] == {
        "admin": True,
        "account_manager": False,
        "recruiter": False,
        "viewer": False,
    }


def test_reset_requires_admin(client: TestClient, admin_user, recruiter_user) -> None:
    rec_h = auth_headers(client, recruiter_user.email)
    r = client.post("/api/v1/permissions-matrix/reset", headers=rec_h)
    assert r.status_code == 403
