"""Тесты Этапа 7: notifications + analytics."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def _client_payload(am_id):
    return {
        "name": "Acme",
        "industry": "fintech",
        "accountManagerId": str(am_id),
        "status": "lead",
        "clientKind": "direct",
    }


def _vac_payload(client_id, am_id, **overrides):
    p = {
        "title": "Senior Backend",
        "clientId": client_id,
        "engagementType": "outstaff",
        "grade": "Senior",
        "format": "Гибрид",
        "rateClient": 3500,
        "positions": 1,
        "status": "new",
        "priority": "medium",
        "accountManagerId": str(am_id),
        "recruiterIds": [],
    }
    p.update(overrides)
    return p


def _cand_payload(recruiter_id, **overrides):
    p = {
        "fullName": "Иван Иванов",
        "role": "Backend",
        "engagementType": "outstaff",
        "grade": "Senior",
        "experienceYears": 7,
        "stack": ["Python"],
        "rateMonth": 350000,
        "employmentType": "СМЗ",
        "format": "Удалённо",
        "location": "Москва",
        "recruiterId": str(recruiter_id),
        "status": "new",
        "email": "ivan@example.com",
    }
    p.update(overrides)
    return p


# ───── notifications ─────


def test_attach_notifies_recruiters_and_am(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h_admin, json=_client_payload(account_manager_user.id)).json()["id"]
    vid = client.post(
        "/api/v1/vacancies",
        headers=h_admin,
        json=_vac_payload(cid, account_manager_user.id, recruiterIds=[str(recruiter_user.id)]),
    ).json()["id"]
    cand_id = client.post("/api/v1/candidates", headers=h_admin, json=_cand_payload(recruiter_user.id)).json()["id"]

    # admin прикрепляет → recruiter и AM должны получить notification.
    client.post(
        f"/api/v1/vacancies/{vid}/candidates",
        headers=h_admin,
        json={"candidateId": cand_id},
    )

    h_rec = auth_headers(client, recruiter_user.email)
    r = client.get("/api/v1/notifications", headers=h_rec)
    assert r.status_code == 200
    items = r.json()
    assert any("прикреплён" in n["text"] for n in items)

    h_am = auth_headers(client, account_manager_user.email)
    assert any("прикреплён" in n["text"] for n in client.get("/api/v1/notifications", headers=h_am).json())


def test_mark_read_and_mark_all(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h_admin, json=_client_payload(account_manager_user.id)).json()["id"]
    vid = client.post(
        "/api/v1/vacancies",
        headers=h_admin,
        json=_vac_payload(cid, account_manager_user.id, recruiterIds=[str(recruiter_user.id)]),
    ).json()["id"]
    cand_id = client.post(
        "/api/v1/candidates", headers=h_admin, json=_cand_payload(recruiter_user.id)
    ).json()["id"]
    client.post(
        f"/api/v1/vacancies/{vid}/candidates",
        headers=h_admin,
        json={"candidateId": cand_id},
    )

    h_rec = auth_headers(client, recruiter_user.email)
    items = client.get("/api/v1/notifications", headers=h_rec).json()
    assert items
    target = items[0]
    r = client.patch(f"/api/v1/notifications/{target['id']}/read", headers=h_rec)
    assert r.status_code == 200
    assert r.json()["read"] is True

    # mark-all-read
    r = client.post("/api/v1/notifications/read-all", headers=h_rec)
    assert r.status_code == 200
    items = client.get("/api/v1/notifications", headers=h_rec).json()
    assert all(n["read"] for n in items)


def test_status_change_notifies_recruiter(
    client: TestClient, admin_user, recruiter_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    cand_id = client.post(
        "/api/v1/candidates", headers=h_admin, json=_cand_payload(recruiter_user.id)
    ).json()["id"]
    # admin меняет статус → recruiter должен получить уведомление
    client.patch(
        f"/api/v1/candidates/{cand_id}/status",
        headers=h_admin,
        json={"status": "ready"},
    )

    h_rec = auth_headers(client, recruiter_user.email)
    items = client.get("/api/v1/notifications", headers=h_rec).json()
    assert any("Иван" in n["text"] for n in items)


def test_self_status_change_does_not_notify(
    client: TestClient, admin_user, recruiter_user
) -> None:
    h_rec = auth_headers(client, recruiter_user.email)
    cand_id = client.post(
        "/api/v1/candidates", headers=h_rec, json=_cand_payload(recruiter_user.id)
    ).json()["id"]
    # сам recruiter меняет статус — пусто
    client.patch(
        f"/api/v1/candidates/{cand_id}/status", headers=h_rec, json={"status": "ready"}
    )
    items = client.get("/api/v1/notifications", headers=h_rec).json()
    assert all("статус" not in n["text"] for n in items)


# ───── analytics ─────


def test_summary_counts_open_and_active(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)).json()["id"]
    # 2 открытых вакансии (new, in_work) + 1 закрытая
    client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id, title="V1")
    )
    v2 = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id, title="V2")
    ).json()
    client.patch(f"/api/v1/vacancies/{v2['id']}/status", headers=h, json={"status": "in_work"})
    v3 = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id, title="V3")
    ).json()
    client.patch(f"/api/v1/vacancies/{v3['id']}/status", headers=h, json={"status": "in_work"})
    client.patch(
        f"/api/v1/vacancies/{v3['id']}/status",
        headers=h,
        json={"status": "closed", "comment": "—"},
    )

    # 2 активных кандидата + 1 hired
    client.post(
        "/api/v1/candidates",
        headers=h,
        json=_cand_payload(recruiter_user.id, email="a@x.ru"),
    )
    client.post(
        "/api/v1/candidates",
        headers=h,
        json=_cand_payload(recruiter_user.id, email="b@x.ru"),
    )

    r = client.get("/api/v1/analytics/summary", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["openVacancies"] == 2
    assert body["activeCandidates"] >= 2
    assert body["closedThisMonth"] == 1


def test_funnel_includes_all_statuses(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)).json()["id"]
    client.post("/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id))

    r = client.get("/api/v1/analytics/funnel", headers=h)
    assert r.status_code == 200
    buckets = r.json()
    statuses = {b["status"] for b in buckets}
    assert {"new", "in_work", "closed", "closed_success", "paused"} <= statuses


def test_recruiter_load(
    client: TestClient, admin_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    client.post(
        "/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id, email="x@x.ru")
    )
    r = client.get("/api/v1/analytics/recruiter-load", headers=h)
    assert r.status_code == 200
    rows = r.json()
    assert any(r["recruiterId"] == str(recruiter_user.id) and r["activeCount"] >= 1 for r in rows)
