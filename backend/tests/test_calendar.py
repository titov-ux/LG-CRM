"""Тесты календаря (события / собеседования).

Покрываем ключевые бизнес-правила:
* создание interview-события с matchId двигает связку в `interview`;
* отметка исхода пишет feedback в связку и опц. меняет её статус;
* отмена переводит событие в `canceled`;
* выборка по диапазону дат и фильтрам;
* коллизии слотов разрешены (два собеса в одно время — ок);
* видимость: рекрутер видит только свои события.
"""
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


def _setup_match(client: TestClient, h, am_id, recruiter_id) -> tuple[str, str, str]:
    """Создать клиента+вакансию+кандидата+связку. Вернуть (vid, candId, matchId)."""
    cid = client.post("/api/v1/clients", headers=h, json=_client_payload(am_id)).json()["id"]
    vid = client.post("/api/v1/vacancies", headers=h, json=_vac_payload(cid, am_id)).json()["id"]
    cand_id = client.post(
        "/api/v1/candidates", headers=h, json=_cand_payload(recruiter_id)
    ).json()["id"]
    match_id = client.post(
        f"/api/v1/vacancies/{vid}/candidates", headers=h, json={"candidateId": cand_id}
    ).json()["id"]
    return vid, cand_id, match_id


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _event_payload(start: datetime, **overrides):
    p = {
        "type": "interview",
        "startsAt": _iso(start),
        "locationKind": "online",
    }
    p.update(overrides)
    return p


def test_create_interview_moves_match_to_interview(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    vid, cand_id, match_id = _setup_match(
        client, h, account_manager_user.id, recruiter_user.id
    )

    start = datetime.now(timezone.utc) + timedelta(days=1)
    r = client.post(
        "/api/v1/calendar/events",
        headers=h,
        json=_event_payload(start, candidateId=cand_id, vacancyId=vid, matchId=match_id),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "scheduled"
    assert body["matchId"] == match_id
    # Заголовок сгенерился автоматически.
    assert "Собес" in body["title"]

    # Связка должна была переехать в interview.
    matches = client.get(f"/api/v1/vacancies/{vid}/candidates", headers=h).json()
    assert matches[0]["status"] == "interview"


def test_outcome_writes_feedback_and_moves_match(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    vid, cand_id, match_id = _setup_match(
        client, h, account_manager_user.id, recruiter_user.id
    )
    start = datetime.now(timezone.utc) + timedelta(days=1)
    event_id = client.post(
        "/api/v1/calendar/events",
        headers=h,
        json=_event_payload(start, candidateId=cand_id, vacancyId=vid, matchId=match_id),
    ).json()["id"]

    r = client.post(
        f"/api/v1/calendar/events/{event_id}/outcome",
        headers=h,
        json={"status": "held", "outcome": "Сильный кандидат", "nextMatchStatus": "offered"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "held"
    assert r.json()["outcome"] == "Сильный кандидат"

    matches = client.get(f"/api/v1/vacancies/{vid}/candidates", headers=h).json()
    assert matches[0]["status"] == "offered"
    assert matches[0]["feedback"] == "Сильный кандидат"


def test_outcome_rejects_invalid_status(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    start = datetime.now(timezone.utc) + timedelta(days=1)
    event_id = client.post(
        "/api/v1/calendar/events", headers=h, json=_event_payload(start)
    ).json()["id"]
    r = client.post(
        f"/api/v1/calendar/events/{event_id}/outcome",
        headers=h,
        json={"status": "scheduled"},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_outcome"


def test_cancel_event(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    start = datetime.now(timezone.utc) + timedelta(days=1)
    event_id = client.post(
        "/api/v1/calendar/events", headers=h, json=_event_payload(start)
    ).json()["id"]
    r = client.post(
        f"/api/v1/calendar/events/{event_id}/cancel",
        headers=h,
        json={"reason": "Кандидат отказался"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "canceled"


def test_list_range_filters_by_window(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    inside = datetime.now(timezone.utc) + timedelta(days=2)
    outside = datetime.now(timezone.utc) + timedelta(days=60)
    in_id = client.post(
        "/api/v1/calendar/events", headers=h, json=_event_payload(inside, title="В окне")
    ).json()["id"]
    client.post(
        "/api/v1/calendar/events", headers=h, json=_event_payload(outside, title="Вне окна")
    )

    frm = _iso(datetime.now(timezone.utc) - timedelta(days=1))
    to = _iso(datetime.now(timezone.utc) + timedelta(days=30))
    r = client.get(f"/api/v1/calendar/events?from={frm}&to={to}", headers=h)
    assert r.status_code == 200, r.text
    ids = [e["id"] for e in r.json()]
    assert in_id in ids
    assert all(e["title"] != "Вне окна" for e in r.json())


def test_collisions_allowed(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    """Два собеса у одного участника в одно время — оба создаются."""
    h = auth_headers(client, admin_user.email)
    start = datetime.now(timezone.utc) + timedelta(days=1)
    payload = _event_payload(start, attendeeIds=[str(recruiter_user.id)])
    r1 = client.post("/api/v1/calendar/events", headers=h, json=payload)
    r2 = client.post("/api/v1/calendar/events", headers=h, json=payload)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["id"] != r2.json()["id"]


def test_recruiter_sees_only_own(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    admin_h = auth_headers(client, admin_user.email)
    rec_h = auth_headers(client, recruiter_user.email)
    start = datetime.now(timezone.utc) + timedelta(days=1)

    # Событие, где рекрутер — участник: он его видит.
    own_id = client.post(
        "/api/v1/calendar/events",
        headers=admin_h,
        json=_event_payload(start, attendeeIds=[str(recruiter_user.id)]),
    ).json()["id"]
    # Событие без привязки к рекрутеру: он его НЕ видит.
    foreign_id = client.post(
        "/api/v1/calendar/events", headers=admin_h, json=_event_payload(start)
    ).json()["id"]

    frm = _iso(datetime.now(timezone.utc) - timedelta(days=1))
    to = _iso(datetime.now(timezone.utc) + timedelta(days=30))
    visible = client.get(f"/api/v1/calendar/events?from={frm}&to={to}", headers=rec_h).json()
    ids = [e["id"] for e in visible]
    assert own_id in ids
    assert foreign_id not in ids
