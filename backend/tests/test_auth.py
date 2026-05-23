"""Контрактные тесты walking skeleton: /auth/login, /auth/refresh, /auth/me, /auth/logout."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.modules.auth import store
from app.modules.users.models import User


def _login(client: TestClient, email: str, password: str):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_login_success(client: TestClient, admin_user: User) -> None:
    r = _login(client, admin_user.email, "correct-horse-battery-staple")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accessToken"]
    assert body["refreshToken"]
    # refresh должен прилететь как httpOnly cookie
    assert "refresh_token" in r.cookies


def test_login_wrong_password(client: TestClient, admin_user: User) -> None:
    r = _login(client, admin_user.email, "wrong")
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "invalid_credentials"


def test_login_unknown_email(client: TestClient) -> None:
    r = _login(client, "nobody@lg.ru", "whatever")
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "invalid_credentials"


def test_rate_limit_after_max_attempts(client: TestClient, admin_user: User) -> None:
    """RATE_LIMIT_MAX неверных попыток с одного IP + ещё один запрос → 429."""
    for _ in range(store.LOGIN_RATE_LIMIT_MAX):
        _login(client, admin_user.email, "wrong")
    r = _login(client, admin_user.email, "wrong")
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "rate_limited"


def test_account_lockout(monkeypatch, client: TestClient, admin_user: User) -> None:
    """Через LOCKOUT_THRESHOLD неудач аккаунт блокируется на 15 минут.

    Чтобы rate-limit не вернул 429 раньше lockout — на время теста расширяем
    окно RATE_LIMIT_MAX до большого числа.
    """
    monkeypatch.setattr(store, "LOGIN_RATE_LIMIT_MAX", 1000)
    for _ in range(store.LOGIN_LOCKOUT_THRESHOLD):
        _login(client, admin_user.email, "wrong")
    # Даже корректный пароль теперь — 403 account_locked
    r = _login(client, admin_user.email, "correct-horse-battery-staple")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "account_locked"


def test_me_requires_auth(client: TestClient) -> None:
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401


def test_me_can_update_profile(client: TestClient, admin_user: User) -> None:
    login = _login(client, admin_user.email, "correct-horse-battery-staple")
    assert login.status_code == 200, login.text
    access = login.json()["accessToken"]
    headers = {"Authorization": f"Bearer {access}"}

    r = client.patch(
        "/api/v1/auth/me",
        headers=headers,
        json={
            "fullName": "Новый Админ",
            "email": "new-admin@lg.ru",
            "telegram": None,
        },
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["fullName"] == "Новый Админ"
    assert updated["email"] == "new-admin@lg.ru"
    assert updated["telegram"] is None
    assert updated["initials"] == "НА"

    r = client.get("/api/v1/auth/me", headers=headers)
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["fullName"] == "Новый Админ"
    assert me["email"] == "new-admin@lg.ru"
    assert me["telegram"] is None


def test_full_flow_login_me_refresh_logout(client: TestClient, admin_user: User) -> None:
    r = _login(client, admin_user.email, "correct-horse-battery-staple")
    assert r.status_code == 200
    access = r.json()["accessToken"]

    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["email"].lower() == admin_user.email.lower()
    assert me["role"] == "admin"
    assert me["isActive"] is True
    assert me["fullName"]  # camelCase из бэка

    # refresh — TestClient автоматически проносит cookie
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200, r.text
    new_access = r.json()["accessToken"]
    assert new_access  # новый access выдан; равенство с прежним не проверяем (iat в секундах)

    # logout
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # после logout повторный refresh должен фейлиться
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 401


def test_refresh_without_cookie(client: TestClient) -> None:
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "no_refresh"


def test_inactive_user_cannot_login(client: TestClient, inactive_user: User) -> None:
    r = _login(client, inactive_user.email, "correct-horse-battery-staple")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "user_inactive"


@pytest.mark.parametrize("bad_token", ["not-a-jwt", "Bearer x"])
def test_me_rejects_garbage_token(client: TestClient, bad_token: str) -> None:
    r = client.get("/api/v1/auth/me", headers={"Authorization": bad_token})
    assert r.status_code == 401
