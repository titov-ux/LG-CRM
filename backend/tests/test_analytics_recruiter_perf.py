"""Тесты на /analytics/recruiter-performance."""
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


def _vac_payload(client_id, am_id):
    return {
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
        "email": "rp@x.ru",
    }
    p.update(overrides)
    return p


def test_recruiter_performance_returns_row_per_recruiter(
    client: TestClient, admin_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    # один кандидат у рекрутера
    client.post(
        "/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id)
    )

    r = client.get("/api/v1/analytics/recruiter-performance", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and "period" in body
    ids = {item["recruiterId"] for item in body["items"]}
    assert str(recruiter_user.id) in ids
    row = next(i for i in body["items"] if i["recruiterId"] == str(recruiter_user.id))
    assert row["candidatesCreated"] >= 1
    assert len(row["sparkline"]) == 8


def test_recruiter_performance_hire_rate_math(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid_client = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)
    ).json()["id"]
    vid = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid_client, account_manager_user.id)
    ).json()["id"]
    # presented через смену статуса
    cand = client.post(
        "/api/v1/candidates",
        headers=h,
        json=_cand_payload(recruiter_user.id, email="hr@x.ru"),
    ).json()
    client.post(
        f"/api/v1/vacancies/{vid}/candidates", headers=h, json={"candidateId": cand["id"]}
    )
    client.patch(
        f"/api/v1/candidates/{cand['id']}/status",
        headers=h,
        json={"status": "presented"},
    )
    client.patch(
        f"/api/v1/candidates/{cand['id']}/status",
        headers=h,
        json={"status": "hired", "comment": "—"},
    )

    body = client.get("/api/v1/analytics/recruiter-performance", headers=h).json()
    row = next(i for i in body["items"] if i["recruiterId"] == str(recruiter_user.id))
    assert row["hired"] >= 1
    assert row["presented"] >= 1
    # hire_rate ≤ 100
    assert 0 <= row["hireRatePct"] <= 100
