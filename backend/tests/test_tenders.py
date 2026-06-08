"""Тесты прав на создание тендеров (особенно — аккаунт-менеджер)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def _payload(**overrides) -> dict:
    payload = {
        "title": "Подбор ИТ-персонала",
        "customer": "ГБУ «Тест»",
        "law": "fz44",
        "nmck": 1_000_000,
        "priority": "medium",
        "status": "lead",
    }
    payload.update(overrides)
    return payload


def test_am_create_without_responsible_defaults_to_self(
    client: TestClient, account_manager_user
) -> None:
    """AM не указал ответственного — тендер создаётся на него самого, без 403."""
    h = auth_headers(client, account_manager_user.email)
    r = client.post("/api/v1/tenders", headers=h, json=_payload())
    assert r.status_code == 201, r.text
    assert r.json()["accountManagerId"] == str(account_manager_user.id)


def test_am_create_on_self_explicit(client: TestClient, account_manager_user) -> None:
    h = auth_headers(client, account_manager_user.email)
    r = client.post(
        "/api/v1/tenders",
        headers=h,
        json=_payload(accountManagerId=str(account_manager_user.id)),
    )
    assert r.status_code == 201, r.text
    assert r.json()["accountManagerId"] == str(account_manager_user.id)


def test_am_cannot_create_on_other(
    client: TestClient, account_manager_user, admin_user
) -> None:
    """AM по-прежнему не может назначить чужого ответственного."""
    h = auth_headers(client, account_manager_user.email)
    r = client.post(
        "/api/v1/tenders",
        headers=h,
        json=_payload(accountManagerId=str(admin_user.id)),
    )
    assert r.status_code == 403, r.text


def test_admin_create_without_responsible_allowed(
    client: TestClient, admin_user
) -> None:
    """Админу автоподстановка не нужна — допустим тендер без ответственного."""
    h = auth_headers(client, admin_user.email)
    r = client.post("/api/v1/tenders", headers=h, json=_payload())
    assert r.status_code == 201, r.text
    assert r.json()["accountManagerId"] is None
