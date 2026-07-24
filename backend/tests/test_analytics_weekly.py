"""Тесты для /analytics/weekly-activity («Итоги недели»)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def _client_payload(am_id):
    return {
        "name": "Acme Weekly",
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
        "email": "ivan-weekly@example.com",
    }
    p.update(overrides)
    return p


def test_weekly_activity_lists_new_vacancies_and_submissions(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid_client = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)
    ).json()["id"]
    vac = client.post(
        "/api/v1/vacancies",
        headers=h,
        json=_vac_payload(cid_client, account_manager_user.id, title="Weekly Vac"),
    ).json()
    cand = client.post(
        "/api/v1/candidates",
        headers=h,
        json=_cand_payload(recruiter_user.id),
    ).json()
    r = client.post(
        f"/api/v1/vacancies/{vac['id']}/candidates",
        headers=h,
        json={"candidateId": cand["id"]},
    )
    assert r.status_code in (200, 201), r.text

    now = datetime.now(timezone.utc)
    params = {
        "from": (now - timedelta(days=1)).isoformat(),
        "to": (now + timedelta(minutes=1)).isoformat(),
    }
    r = client.get("/api/v1/analytics/weekly-activity", headers=h, params=params)
    assert r.status_code == 200, r.text
    body = r.json()

    # структура ответа
    assert "from" in body["period"] and "to" in body["period"]
    assert body["newVacancies"]["total"] >= 1
    assert body["submittedCandidates"]["total"] >= 1
    assert "interviews" in body and body["interviews"]["total"] >= 0
    assert "interviewsHeld" in body and body["interviewsHeld"]["total"] >= 0

    # свежесозданная вакансия в списке — с клиентом и id для перехода
    vac_item = next(
        i for i in body["newVacancies"]["items"] if i["id"] == vac["id"]
    )
    assert vac_item["title"] == "Weekly Vac"
    assert vac_item["clientName"] == "Acme Weekly"
    assert vac_item["status"] == "new"

    # подача видна с обеими сторонами связки
    sub = next(
        i
        for i in body["submittedCandidates"]["items"]
        if i["candidateId"] == cand["id"]
    )
    assert sub["vacancyId"] == vac["id"]
    assert sub["vacancyTitle"] == "Weekly Vac"
    assert sub["candidateName"] == "Иван Иванов"
    assert sub["clientName"] == "Acme Weekly"
    assert sub["status"] == "submitted"

    # разбивки: вакансия учтена за аккаунт-менеджером, подача — за тем, кто
    # прикрепил кандидата (в тесте это админ)
    mgr = next(
        r
        for r in body["byManagers"]
        if r["userId"] == str(account_manager_user.id)
    )
    assert mgr["count"] >= 1 and mgr["fullName"]
    rec = next(
        r for r in body["byRecruiters"] if r["userId"] == str(admin_user.id)
    )
    assert rec["count"] >= 1 and rec["fullName"]


def test_weekly_activity_window_excludes_outside(
    client: TestClient, admin_user, account_manager_user
) -> None:
    """Окно в прошлом (до создания сущностей) — списки пустые."""
    h = auth_headers(client, admin_user.email)
    cid_client = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)
    ).json()["id"]
    client.post(
        "/api/v1/vacancies",
        headers=h,
        json=_vac_payload(cid_client, account_manager_user.id, title="Вне окна"),
    )

    now = datetime.now(timezone.utc)
    params = {
        "from": (now - timedelta(days=21)).isoformat(),
        "to": (now - timedelta(days=14)).isoformat(),
    }
    r = client.get("/api/v1/analytics/weekly-activity", headers=h, params=params)
    assert r.status_code == 200, r.text
    body = r.json()
    titles = [i["title"] for i in body["newVacancies"]["items"]]
    assert "Вне окна" not in titles


def test_weekly_activity_defaults_to_current_week(
    client: TestClient, admin_user
) -> None:
    """Без параметров окно — с понедельника текущей недели по сейчас."""
    h = auth_headers(client, admin_user.email)
    r = client.get("/api/v1/analytics/weekly-activity", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    from_dt = datetime.fromisoformat(body["period"]["from"])
    now = datetime.now(timezone.utc)
    assert from_dt.weekday() == 0  # понедельник
    assert from_dt <= now
    assert (now - from_dt) <= timedelta(days=7)
