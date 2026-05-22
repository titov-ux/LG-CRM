"""Тесты CRUD /users.

Покрытие:
- GET доступен любой авторизованной роли;
- POST/PATCH/DELETE — только admin (recruiter получает 403);
- удалить себя нельзя (400 cannot_delete_self);
- email-конфликт → 409;
- неавторизованный → 401.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def test_list_requires_auth(client: TestClient) -> None:
    r = client.get("/api/v1/users")
    assert r.status_code == 401


def test_recruiter_can_list_but_not_create(client: TestClient, admin_user, recruiter_user) -> None:
    rec_headers = auth_headers(client, recruiter_user.email)
    r = client.get("/api/v1/users", headers=rec_headers)
    assert r.status_code == 200
    emails = {u["email"].lower() for u in r.json()}
    assert {admin_user.email.lower(), recruiter_user.email.lower()} <= emails

    r = client.post(
        "/api/v1/users",
        headers=rec_headers,
        json={
            "email": "new@lg.ru",
            "fullName": "Новый Сотрудник",
            "role": "recruiter",
            "password": "supersecret",
        },
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


def test_admin_can_create_update_delete(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    # create
    r = client.post(
        "/api/v1/users",
        headers=h,
        json={
            "email": "manager@lg.ru",
            "fullName": "Аккаунт Менеджер",
            "role": "account_manager",
            "telegram": "@am",
            "password": "supersecret",
        },
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["email"] == "manager@lg.ru"
    assert created["initials"] == "АМ"
    assert created["role"] == "account_manager"
    user_id = created["id"]

    # update — снять активность и сменить telegram
    r = client.patch(
        f"/api/v1/users/{user_id}",
        headers=h,
        json={"isActive": False, "telegram": "@am_new"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["isActive"] is False
    assert r.json()["telegram"] == "@am_new"

    # delete
    r = client.delete(f"/api/v1/users/{user_id}", headers=h)
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_admin_cannot_delete_self(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.delete(f"/api/v1/users/{admin_user.id}", headers=h)
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "cannot_delete_self"


def test_email_conflict(client: TestClient, admin_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/users",
        headers=h,
        json={
            "email": recruiter_user.email,
            "fullName": "Дубликат",
            "role": "recruiter",
            "password": "supersecret",
        },
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "email_exists"
