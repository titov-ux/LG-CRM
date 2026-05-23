"""Тесты /vacancies + kanban-операций."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def _create_client(client: TestClient, headers: dict[str, str], account_manager_id) -> str:
    r = client.post(
        "/api/v1/clients",
        headers=headers,
        json={
            "name": "Acme",
            "industry": "fintech",
            "accountManagerId": str(account_manager_id),
            "status": "lead",
            "clientKind": "direct",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _vac_payload(client_id: str, account_manager_id, **overrides):
    payload = {
        "title": "Senior Backend",
        "clientId": client_id,
        "engagementType": "outstaff",
        "grade": "Senior",
        "format": "Гибрид",
        "rateClient": 3500,
        "positions": 1,
        "status": "new",
        "priority": "medium",
        "accountManagerId": str(account_manager_id),
        "stack": ["Python", "FastAPI"],
        "recruiterIds": [],
    }
    payload.update(overrides)
    return payload


def test_create_list_get(client: TestClient, admin_user, account_manager_user) -> None:
    h = auth_headers(client, admin_user.email)
    cid = _create_client(client, h, account_manager_user.id)

    r = client.post("/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["title"] == "Senior Backend"
    assert body["stack"] == ["Python", "FastAPI"]
    assert body["status"] == "new"
    assert body["kanbanOrder"] == 0
    vac_id = body["id"]

    r = client.get(f"/api/v1/vacancies/{vac_id}", headers=h)
    assert r.status_code == 200
    assert r.json()["id"] == vac_id

    r = client.get("/api/v1/vacancies", headers=h)
    assert r.status_code == 200
    assert r.json()["total"] == 1


def test_filters(client: TestClient, admin_user, account_manager_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    cid = _create_client(client, h, account_manager_user.id)
    # три вакансии разных параметров
    client.post(
        "/api/v1/vacancies",
        headers=h,
        json=_vac_payload(cid, account_manager_user.id, title="Py Sr", grade="Senior", stack=["Python"]),
    )
    client.post(
        "/api/v1/vacancies",
        headers=h,
        json=_vac_payload(
            cid,
            account_manager_user.id,
            title="Go Mid",
            grade="Middle",
            stack=["Go"],
            engagementType="agency",
        ),
    )
    client.post(
        "/api/v1/vacancies",
        headers=h,
        json=_vac_payload(
            cid,
            account_manager_user.id,
            title="React Jr",
            grade="Junior",
            stack=["React"],
            recruiterIds=[str(recruiter_user.id)],
        ),
    )

    # grade
    r = client.get("/api/v1/vacancies?grade=Senior", headers=h)
    assert {v["title"] for v in r.json()["items"]} == {"Py Sr"}
    # engagementType
    r = client.get("/api/v1/vacancies?engagementType=agency", headers=h)
    assert {v["title"] for v in r.json()["items"]} == {"Go Mid"}
    # recruiterId
    r = client.get(f"/api/v1/vacancies?recruiterId={recruiter_user.id}", headers=h)
    assert {v["title"] for v in r.json()["items"]} == {"React Jr"}
    # search по title
    r = client.get("/api/v1/vacancies?search=react", headers=h)
    assert {v["title"] for v in r.json()["items"]} == {"React Jr"}


def test_visibility_for_account_manager(
    client: TestClient, admin_user, account_manager_user, other_account_manager_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    cid_mine = _create_client(client, h_admin, account_manager_user.id)
    cid_other = _create_client(client, h_admin, other_account_manager_user.id)
    client.post(
        "/api/v1/vacancies",
        headers=h_admin,
        json=_vac_payload(cid_mine, account_manager_user.id, title="Mine"),
    )
    client.post(
        "/api/v1/vacancies",
        headers=h_admin,
        json=_vac_payload(cid_other, other_account_manager_user.id, title="Other"),
    )

    h_am = auth_headers(client, account_manager_user.email)
    r = client.get("/api/v1/vacancies", headers=h_am)
    assert {v["title"] for v in r.json()["items"]} == {"Mine"}


def test_transitions_endpoint(client: TestClient, recruiter_user) -> None:
    h = auth_headers(client, recruiter_user.email)
    r = client.get("/api/v1/vacancies/transitions", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "new" in body["transitions"]
    assert "in_work" in body["transitions"]["new"]
    assert set(body["finalStatuses"]) == {"closed_success", "closed"}


def test_invalid_transition_blocked(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = _create_client(client, h, account_manager_user.id)
    r = client.post("/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id))
    vac_id = r.json()["id"]

    # new → closed_success запрещён напрямую
    r = client.patch(
        f"/api/v1/vacancies/{vac_id}/status",
        headers=h,
        json={"status": "closed_success", "comment": "yay"},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_transition"


def test_final_status_requires_comment(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = _create_client(client, h, account_manager_user.id)
    r = client.post("/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id))
    vac_id = r.json()["id"]

    # new → in_work (ок) → closed без комментария → 422
    r = client.patch(f"/api/v1/vacancies/{vac_id}/status", headers=h, json={"status": "in_work"})
    assert r.status_code == 200

    r = client.patch(
        f"/api/v1/vacancies/{vac_id}/status",
        headers=h,
        json={"status": "closed"},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "comment_required"

    # с комментарием — ок
    r = client.patch(
        f"/api/v1/vacancies/{vac_id}/status",
        headers=h,
        json={"status": "closed", "comment": "клиент отменил"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "closed"


def test_kanban_reorder(client: TestClient, admin_user, account_manager_user) -> None:
    h = auth_headers(client, admin_user.email)
    cid = _create_client(client, h, account_manager_user.id)
    # три вакансии в new
    ids = []
    for i in range(3):
        r = client.post(
            "/api/v1/vacancies",
            headers=h,
            json=_vac_payload(cid, account_manager_user.id, title=f"V{i}"),
        )
        ids.append(r.json()["id"])

    # перенумеровать в обратном порядке, последний — в in_work
    payload = {
        "updates": [
            {"id": ids[2], "status": "new", "kanbanOrder": 0},
            {"id": ids[1], "status": "new", "kanbanOrder": 1},
            {"id": ids[0], "status": "in_work", "kanbanOrder": 0},
        ]
    }
    r = client.put("/api/v1/vacancies/kanban-order", headers=h, json=payload)
    assert r.status_code == 200, r.text

    # проверим
    r = client.get("/api/v1/vacancies", headers=h)
    items = {v["id"]: v for v in r.json()["items"]}
    assert items[ids[2]]["status"] == "new" and items[ids[2]]["kanbanOrder"] == 0
    assert items[ids[1]]["kanbanOrder"] == 1
    assert items[ids[0]]["status"] == "in_work"


def test_kanban_reorder_cannot_close(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = _create_client(client, h, account_manager_user.id)
    r = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id)
    )
    vac_id = r.json()["id"]

    # сначала переведём в interview, оттуда теоретически можно закрыть
    client.patch(f"/api/v1/vacancies/{vac_id}/status", headers=h, json={"status": "in_work"})
    client.patch(
        f"/api/v1/vacancies/{vac_id}/status", headers=h, json={"status": "interview"}
    )

    # попытка закрыть через kanban-reorder — запрещено
    r = client.put(
        "/api/v1/vacancies/kanban-order",
        headers=h,
        json={"updates": [{"id": vac_id, "status": "closed_success", "kanbanOrder": 0}]},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "comment_required"


def test_update_recruiters(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = _create_client(client, h, account_manager_user.id)
    r = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id)
    )
    vac_id = r.json()["id"]

    r = client.patch(
        f"/api/v1/vacancies/{vac_id}",
        headers=h,
        json={"recruiterIds": [str(recruiter_user.id)]},
    )
    assert r.status_code == 200
    assert r.json()["recruiterIds"] == [str(recruiter_user.id)]


def test_soft_delete(client: TestClient, admin_user, account_manager_user) -> None:
    h = auth_headers(client, admin_user.email)
    cid = _create_client(client, h, account_manager_user.id)
    r = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id)
    )
    vac_id = r.json()["id"]
    r = client.delete(f"/api/v1/vacancies/{vac_id}", headers=h)
    assert r.status_code == 200
    r = client.get(f"/api/v1/vacancies/{vac_id}", headers=h)
    assert r.status_code == 404
