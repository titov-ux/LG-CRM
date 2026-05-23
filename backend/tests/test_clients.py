"""Тесты /clients и /clients/{id}/contacts."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def _make_client_payload(account_manager_id, **overrides) -> dict:
    payload = {
        "name": "Acme",
        "industry": "fintech",
        "accountManagerId": str(account_manager_id),
        "status": "lead",
        "clientKind": "direct",
        "legalEntities": [{"name": "ООО Акме", "inn": "7700000000"}],
    }
    payload.update(overrides)
    return payload


def test_list_requires_auth(client: TestClient) -> None:
    r = client.get("/api/v1/clients")
    assert r.status_code == 401


def test_admin_create_and_list(client: TestClient, admin_user, account_manager_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/clients", headers=h, json=_make_client_payload(account_manager_user.id)
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Acme"
    assert body["clientKind"] == "direct"
    assert body["legalEntities"][0]["inn"] == "7700000000"

    r = client.get("/api/v1/clients", headers=h)
    assert r.status_code == 200
    assert r.json()["total"] == 1


def test_filter_by_status_kind_industry(client: TestClient, admin_user, account_manager_user) -> None:
    h = auth_headers(client, admin_user.email)
    client.post(
        "/api/v1/clients",
        headers=h,
        json=_make_client_payload(account_manager_user.id, name="Direct A", clientKind="direct", industry="fintech"),
    )
    client.post(
        "/api/v1/clients",
        headers=h,
        json=_make_client_payload(
            account_manager_user.id, name="Inter B", clientKind="intermediary", industry="retail"
        ),
    )

    r = client.get("/api/v1/clients?clientKind=direct", headers=h)
    assert r.status_code == 200
    assert {c["name"] for c in r.json()["items"]} == {"Direct A"}

    r = client.get("/api/v1/clients?industry=retail", headers=h)
    assert {c["name"] for c in r.json()["items"]} == {"Inter B"}


def test_account_manager_sees_only_own_clients(
    client: TestClient, admin_user, account_manager_user, other_account_manager_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    # один клиент назначен на am#1, другой — на am#2
    client.post(
        "/api/v1/clients",
        headers=h_admin,
        json=_make_client_payload(account_manager_user.id, name="Mine"),
    )
    client.post(
        "/api/v1/clients",
        headers=h_admin,
        json=_make_client_payload(other_account_manager_user.id, name="Other"),
    )

    h_am = auth_headers(client, account_manager_user.email)
    r = client.get("/api/v1/clients", headers=h_am)
    assert r.status_code == 200
    names = {c["name"] for c in r.json()["items"]}
    assert names == {"Mine"}


def test_account_manager_cannot_create_for_other(
    client: TestClient, account_manager_user, other_account_manager_user
) -> None:
    h = auth_headers(client, account_manager_user.email)
    r = client.post(
        "/api/v1/clients",
        headers=h,
        json=_make_client_payload(other_account_manager_user.id),
    )
    assert r.status_code == 403


def test_recruiter_cannot_create(client: TestClient, recruiter_user, account_manager_user) -> None:
    h = auth_headers(client, recruiter_user.email)
    r = client.post(
        "/api/v1/clients",
        headers=h,
        json=_make_client_payload(account_manager_user.id),
    )
    assert r.status_code == 403


def test_only_admin_can_delete(client: TestClient, admin_user, account_manager_user) -> None:
    h_admin = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/clients",
        headers=h_admin,
        json=_make_client_payload(account_manager_user.id),
    )
    cid = r.json()["id"]

    # account_manager пытается удалить — нельзя
    h_am = auth_headers(client, account_manager_user.email)
    r = client.delete(f"/api/v1/clients/{cid}", headers=h_am)
    assert r.status_code == 403

    # admin — можно (soft-delete)
    r = client.delete(f"/api/v1/clients/{cid}", headers=h_admin)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # после soft-delete клиента не видно в списке
    r = client.get("/api/v1/clients", headers=h_admin)
    assert r.json()["total"] == 0
    # и по id — 404
    r = client.get(f"/api/v1/clients/{cid}", headers=h_admin)
    assert r.status_code == 404


def test_search_by_legal_entity_inn(client: TestClient, admin_user, account_manager_user) -> None:
    h = auth_headers(client, admin_user.email)
    client.post(
        "/api/v1/clients",
        headers=h,
        json=_make_client_payload(
            account_manager_user.id,
            name="Acme",
            legalEntities=[{"name": "ООО Акме", "inn": "1234567890"}],
        ),
    )
    r = client.get("/api/v1/clients?search=1234567", headers=h)
    assert r.status_code == 200
    assert r.json()["total"] == 1


def test_update_replaces_legal_entities(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/clients",
        headers=h,
        json=_make_client_payload(account_manager_user.id),
    )
    cid = r.json()["id"]

    r = client.patch(
        f"/api/v1/clients/{cid}",
        headers=h,
        json={"legalEntities": [{"name": "ИП Новый", "inn": "9999999999"}]},
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["legalEntities"]) == 1
    assert body["legalEntities"][0]["inn"] == "9999999999"


def test_add_and_list_contact(client: TestClient, admin_user, account_manager_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/clients",
        headers=h,
        json=_make_client_payload(account_manager_user.id),
    )
    cid = r.json()["id"]

    r = client.post(
        f"/api/v1/clients/{cid}/contacts",
        headers=h,
        json={"name": "Иван", "role": "ЛПР", "email": "ivan@acme.ru", "phone": "+7-999-000"},
    )
    assert r.status_code == 201, r.text

    # GET /clients/{id}/contacts
    r = client.get(f"/api/v1/clients/{cid}/contacts", headers=h)
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["name"] == "Иван"

    # contacts_count в карточке клиента обновился (производный счётчик)
    r = client.get(f"/api/v1/clients/{cid}", headers=h)
    assert r.json()["contactsCount"] == 1


def test_flat_contacts_list_and_filters(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/clients",
        headers=h,
        json=_make_client_payload(account_manager_user.id, name="Acme"),
    )
    cid = r.json()["id"]
    client.post(
        f"/api/v1/clients/{cid}/contacts",
        headers=h,
        json={"name": "Ann", "role": "PM", "email": "ann@acme.ru"},
    )
    client.post(
        f"/api/v1/clients/{cid}/contacts",
        headers=h,
        json={"name": "Bob", "role": "DEV"},
    )

    r = client.get("/api/v1/contacts", headers=h)
    items = r.json()["items"]
    assert {c["name"] for c in items} == {"Ann", "Bob"}
    assert all(c["clientName"] == "Acme" for c in items)

    r = client.get("/api/v1/contacts?hasEmail=true", headers=h)
    assert {c["name"] for c in r.json()["items"]} == {"Ann"}

    r = client.get("/api/v1/contacts?search=acme", headers=h)
    # search по client.name тоже работает
    assert r.json()["total"] == 2
