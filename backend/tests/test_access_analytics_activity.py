"""Доступы: раздел /analytics — только admin; ленты активности вакансий и
тендеров уважают видимость карточки (account_manager — только свои)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import auth_headers

ANALYTICS_PATHS = [
    "/api/v1/analytics/summary",
    "/api/v1/analytics/funnel",
    "/api/v1/analytics/funnel-v2",
    "/api/v1/analytics/recruiter-load",
    "/api/v1/analytics/trends",
    "/api/v1/analytics/interview-stats",
    "/api/v1/analytics/time-to-hire",
    "/api/v1/analytics/attention",
    "/api/v1/analytics/recruiter-performance",
    "/api/v1/analytics/client-performance",
    "/api/v1/analytics/weekly-activity",
    "/api/v1/analytics/chat",
]


@pytest.mark.parametrize("path", ANALYTICS_PATHS)
def test_analytics_forbidden_for_non_admin(
    client: TestClient, recruiter_user, account_manager_user, path: str
) -> None:
    for user in (recruiter_user, account_manager_user):
        h = auth_headers(client, user.email)
        r = client.get(path, headers=h)
        assert r.status_code == 403, (user.email, path, r.text)


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/analytics/summary",
        "/api/v1/analytics/recruiter-performance",
        "/api/v1/analytics/client-performance",
        "/api/v1/analytics/attention",
    ],
)
def test_analytics_allowed_for_admin(client: TestClient, admin_user, path: str) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.get(path, headers=h)
    assert r.status_code == 200, r.text


def _create_vacancy(client: TestClient, h: dict[str, str], am_id) -> str:
    r = client.post(
        "/api/v1/clients",
        headers=h,
        json={
            "name": "Acme",
            "industry": "fintech",
            "accountManagerId": str(am_id),
            "status": "lead",
            "clientKind": "direct",
        },
    )
    assert r.status_code == 201, r.text
    r = client.post(
        "/api/v1/vacancies",
        headers=h,
        json={
            "title": "Senior Backend",
            "clientId": r.json()["id"],
            "engagementType": "outstaff",
            "grade": "Senior",
            "format": "Гибрид",
            "rateClient": 3500,
            "positions": 1,
            "status": "new",
            "priority": "medium",
            "accountManagerId": str(am_id),
            "stack": ["Python"],
            "recruiterIds": [],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_vacancy_activity_hidden_from_other_am(
    client: TestClient, admin_user, account_manager_user, other_account_manager_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    vac_id = _create_vacancy(client, h_admin, account_manager_user.id)

    h_owner = auth_headers(client, account_manager_user.email)
    assert client.get(f"/api/v1/vacancies/{vac_id}/activity", headers=h_owner).status_code == 200

    h_other = auth_headers(client, other_account_manager_user.email)
    r = client.get(f"/api/v1/vacancies/{vac_id}/activity", headers=h_other)
    assert r.status_code == 403, r.text


def test_tender_activity_hidden_from_other_am(
    client: TestClient, admin_user, account_manager_user, other_account_manager_user
) -> None:
    h_owner = auth_headers(client, account_manager_user.email)
    r = client.post(
        "/api/v1/tenders",
        headers=h_owner,
        json={
            "title": "Подбор ИТ-персонала",
            "customer": "ГБУ «Тест»",
            "law": "fz44",
            "nmck": 1_000_000,
            "priority": "medium",
            "status": "lead",
        },
    )
    assert r.status_code == 201, r.text
    tender_id = r.json()["id"]
    assert client.get(f"/api/v1/tenders/{tender_id}/activity", headers=h_owner).status_code == 200

    h_other = auth_headers(client, other_account_manager_user.email)
    r = client.get(f"/api/v1/tenders/{tender_id}/activity", headers=h_other)
    assert r.status_code == 403, r.text

    h_admin = auth_headers(client, admin_user.email)
    assert client.get(f"/api/v1/tenders/{tender_id}/activity", headers=h_admin).status_code == 200
