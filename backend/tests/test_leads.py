"""Тесты лидов: права на создание (AM), kanban-переходы, финальные статусы."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def _payload(**overrides) -> dict:
    payload = {
        "title": "Подбор 5 Java-разработчиков",
        "company": "ООО «Тест»",
        "contactName": "Иван Петров",
        "phone": "+7 900 000-00-00",
        "email": "ivan@test.ru",
        "priority": "medium",
        "status": "new",
    }
    payload.update(overrides)
    return payload


def test_am_create_without_responsible_defaults_to_self(
    client: TestClient, account_manager_user
) -> None:
    h = auth_headers(client, account_manager_user.email)
    r = client.post("/api/v1/leads", headers=h, json=_payload())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["accountManagerId"] == str(account_manager_user.id)
    assert body["contactName"] == "Иван Петров"
    assert body["email"] == "ivan@test.ru"


def test_am_cannot_create_on_other(
    client: TestClient, account_manager_user, admin_user
) -> None:
    h = auth_headers(client, account_manager_user.email)
    r = client.post(
        "/api/v1/leads", headers=h, json=_payload(accountManagerId=str(admin_user.id))
    )
    assert r.status_code == 403, r.text


def test_blank_contacts_stored_as_null(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post("/api/v1/leads", headers=h, json=_payload(phone="  ", email=""))
    assert r.status_code == 201, r.text
    assert r.json()["phone"] is None
    assert r.json()["email"] is None


def test_final_status_requires_comment(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    lead_id = client.post("/api/v1/leads", headers=h, json=_payload()).json()["id"]

    r = client.patch(f"/api/v1/leads/{lead_id}/status", headers=h, json={"status": "won"})
    assert r.status_code == 422, r.text

    r = client.patch(
        f"/api/v1/leads/{lead_id}/status",
        headers=h,
        json={"status": "won", "comment": "Подписали договор"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "won"
    assert "Подписали договор" in (r.json()["note"] or "")


def test_kanban_reorder_moves_between_working_columns(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    lead_id = client.post("/api/v1/leads", headers=h, json=_payload()).json()["id"]

    r = client.put(
        "/api/v1/leads/kanban-order",
        headers=h,
        json={"updates": [{"id": lead_id, "status": "proposal", "kanbanOrder": 0}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()[0]["status"] == "proposal"

    # В финальный статус через reorder нельзя — нужен комментарий.
    r = client.put(
        "/api/v1/leads/kanban-order",
        headers=h,
        json={"updates": [{"id": lead_id, "status": "lost", "kanbanOrder": 0}]},
    )
    assert r.status_code == 422, r.text


def test_search_by_contact(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    client.post("/api/v1/leads", headers=h, json=_payload(contactName="Уникальный Контакт"))
    r = client.get("/api/v1/leads", headers=h, params={"search": "уникальный"})
    assert r.status_code == 200, r.text
    assert r.json()["total"] >= 1
