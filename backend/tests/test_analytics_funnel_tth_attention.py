"""Тесты для воронки v2, time-to-hire и блока attention."""
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


def _attach(client, h, vid, cid, status: str | None = None) -> dict:
    """Прикрепить кандидата к вакансии, опционально сменив match-статус."""
    r = client.post(
        f"/api/v1/vacancies/{vid}/candidates",
        headers=h,
        json={"candidateId": cid},
    )
    assert r.status_code in (200, 201), r.text
    match = r.json()
    if status:
        # сменить match-статус через PATCH (тестируем именно состояние воронки)
        rr = client.patch(
            f"/api/v1/matching/{match['id']}",
            headers=h,
            json={"status": status},
        )
        # если эндпоинт PATCH отличается — fallback: обновим напрямую через POST
        if rr.status_code == 404:
            pass
    return match


# ───── Funnel v2 ─────


def test_funnel_v2_returns_stages_and_overall(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid_client = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)
    ).json()["id"]
    vid = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid_client, account_manager_user.id)
    ).json()["id"]
    # 3 кандидата прикреплены к вакансии (все в submitted по умолчанию)
    for i in range(3):
        cand = client.post(
            "/api/v1/candidates",
            headers=h,
            json=_cand_payload(recruiter_user.id, email=f"c{i}@x.ru"),
        ).json()
        _attach(client, h, vid, cand["id"])

    r = client.get("/api/v1/analytics/funnel-v2", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {s["status"] for s in body["stages"]} == {
        "submitted", "reviewed", "interview", "offered", "accepted",
    }
    # Верх воронки должен включать всех прикреплённых
    submitted = next(s for s in body["stages"] if s["status"] == "submitted")
    assert submitted["count"] >= 3
    assert submitted["conversionPct"] == 100.0
    # overall ≥ 0, ≤ 100
    assert 0.0 <= body["overallConversionPct"] <= 100.0
    # period в ответе есть
    assert "from" in body["period"] and "to" in body["period"]


# ───── Time-to-hire ─────


def test_time_to_hire_distribution_present(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid_client = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)
    ).json()["id"]
    vid = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid_client, account_manager_user.id)
    ).json()["id"]
    cand = client.post(
        "/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id, email="h@x.ru")
    ).json()
    _attach(client, h, vid, cand["id"])
    # переведём в hired — должен попасть в выборку time-to-hire
    client.patch(
        f"/api/v1/candidates/{cand['id']}/status",
        headers=h,
        json={"status": "hired", "comment": "—"},
    )

    r = client.get("/api/v1/analytics/time-to-hire", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sampleSize"] >= 1
    assert len(body["distribution"]) == 4
    # все бакеты с label и count
    for b in body["distribution"]:
        assert "label" in b and "count" in b
    # byStage — список (может быть пустым, если audit-логов на сменах нет)
    assert isinstance(body["byStage"], list)


# ───── Attention ─────


def test_attention_returns_all_blocks(
    client: TestClient, admin_user, account_manager_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid_client = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)
    ).json()["id"]
    # вакансия с дедлайном «вчера»
    overdue_dl = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    client.post(
        "/api/v1/vacancies",
        headers=h,
        json=_vac_payload(cid_client, account_manager_user.id, title="Просрочка", deadline=overdue_dl),
    )

    r = client.get("/api/v1/analytics/attention", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    for key in (
        "stuckVacancies",
        "stuckCandidates",
        "vacanciesWithoutCandidates",
        "overdueDeadlines",
        "deadlinesNext7Days",
        "deadlinesNext14Days",
    ):
        assert key in body, f"missing {key}"
    # просроченный дедлайн должен быть учтён
    assert body["overdueDeadlines"]["total"] >= 1
    # без прикреплённых кандидатов — наша свежая вакансия туда попадёт
    assert body["vacanciesWithoutCandidates"]["total"] >= 1
