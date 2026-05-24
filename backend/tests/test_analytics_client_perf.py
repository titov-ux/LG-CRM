"""Тесты на /analytics/client-performance."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def _client_payload(am_id, name="Acme"):
    return {
        "name": name,
        "industry": "fintech",
        "accountManagerId": str(am_id),
        "status": "lead",
        "clientKind": "direct",
    }


def _vac_payload(client_id, am_id, **overrides):
    p = {
        "title": "Backend",
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
        "email": "cp@x.ru",
    }
    p.update(overrides)
    return p


def test_client_performance_basic(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid_client = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)
    ).json()["id"]
    client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid_client, account_manager_user.id)
    )

    r = client.get("/api/v1/analytics/client-performance", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and "period" in body
    row = next((i for i in body["items"] if i["clientId"] == cid_client), None)
    assert row is not None
    assert row["vacanciesTotal"] >= 1
    assert row["vacanciesOpen"] >= 1
    assert len(row["sparkline"]) == 8
    assert row["industry"] == "fintech"


def test_client_performance_hire_and_margin(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid_client = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id, name="MarginCo")
    ).json()["id"]
    vid = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid_client, account_manager_user.id)
    ).json()["id"]
    cand = client.post(
        "/api/v1/candidates",
        headers=h,
        json=_cand_payload(recruiter_user.id, email="m@x.ru"),
    ).json()
    client.post(
        f"/api/v1/vacancies/{vid}/candidates", headers=h, json={"candidateId": cand["id"]}
    )
    client.patch(
        f"/api/v1/candidates/{cand['id']}/status",
        headers=h,
        json={"status": "hired", "comment": "—"},
    )

    body = client.get("/api/v1/analytics/client-performance", headers=h).json()
    row = next(i for i in body["items"] if i["clientId"] == cid_client)
    assert row["hiresInPeriod"] >= 1
    # margin = (3500 * 160 - 350000) = 210000 ≥ 0
    assert row["monthlyMarginRunRate"] > 0


def test_client_performance_stale_flag(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    # клиент без вакансий — флаг no_vacancies_ever
    cid = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id, name="Idle")
    ).json()["id"]
    body = client.get("/api/v1/analytics/client-performance", headers=h).json()
    row = next(i for i in body["items"] if i["clientId"] == cid)
    assert "no_vacancies_ever" in row["healthFlags"]
