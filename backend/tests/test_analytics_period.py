"""Тесты для расширенной аналитики: period/compare/trends."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

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


# ───── period / compare ─────


def test_summary_returns_period_and_compare_windows(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.get("/api/v1/analytics/summary", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    # обратная совместимость: KPI-поля на месте
    assert "openVacancies" in body
    assert "activeCandidates" in body
    assert "closedThisMonth" in body
    assert "hiredThisMonth" in body
    # новые поля
    assert "period" in body and "from" in body["period"] and "to" in body["period"]
    assert body["compare"] is not None
    assert body["compare"]["mode"] == "prev"


def test_summary_with_explicit_period_and_yoy(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    now = datetime.now(timezone.utc)
    frm = now - timedelta(days=14)
    r = client.get(
        "/api/v1/analytics/summary",
        params={"from": frm.isoformat(), "to": now.isoformat(), "compare": "yoy"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["compare"]["mode"] == "yoy"
    # compare-окно ~ на год раньше
    cmp_from = datetime.fromisoformat(body["compare"]["from"])
    assert (frm - cmp_from).days in (365, 366)


def test_summary_compare_none_zeroes_deltas(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.get(
        "/api/v1/analytics/summary", params={"compare": "none"}, headers=h
    )
    assert r.status_code == 200
    body = r.json()
    assert body["compare"] is None
    assert body["delta"]["closedThisMonth"] == 0
    assert body["delta"]["hiredThisMonth"] == 0


# ───── trends ─────


def test_trends_auto_picks_day_for_short_period(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)
    ).json()["id"]
    # одна свежесозданная вакансия — должна попасть в бакет «сегодня»
    client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id)
    )

    now = datetime.now(timezone.utc)
    frm = now - timedelta(days=7)
    r = client.get(
        "/api/v1/analytics/trends",
        params={"from": frm.isoformat(), "to": now.isoformat()},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["granularity"] == "day"
    # бакетов примерно 7–8 (включая частичные на краях)
    assert 6 <= len(body["series"]["vacanciesCreated"]) <= 9
    # суммарно по vacanciesCreated должна быть как минимум 1
    total_created = sum(p["value"] for p in body["series"]["vacanciesCreated"])
    assert total_created >= 1


def test_trends_auto_picks_week_for_quarter(
    client: TestClient, admin_user
) -> None:
    h = auth_headers(client, admin_user.email)
    now = datetime.now(timezone.utc)
    frm = now - timedelta(days=90)
    r = client.get(
        "/api/v1/analytics/trends",
        params={"from": frm.isoformat(), "to": now.isoformat()},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["granularity"] == "week"


def test_trends_auto_picks_month_for_year(
    client: TestClient, admin_user
) -> None:
    h = auth_headers(client, admin_user.email)
    now = datetime.now(timezone.utc)
    frm = now - timedelta(days=365)
    r = client.get(
        "/api/v1/analytics/trends",
        params={"from": frm.isoformat(), "to": now.isoformat()},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["granularity"] == "month"


def test_trends_returns_all_four_series(
    client: TestClient, admin_user
) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.get("/api/v1/analytics/trends", headers=h)
    assert r.status_code == 200
    series = r.json()["series"]
    assert set(series.keys()) == {
        "vacanciesCreated",
        "vacanciesClosed",
        "candidatesCreated",
        "hires",
    }
