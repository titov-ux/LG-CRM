"""Тесты matching + comments."""
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


# ───── matching ─────


def test_attach_is_idempotent(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)).json()["id"]
    vid = client.post("/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id)).json()["id"]
    cand_id = client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id)).json()["id"]

    r1 = client.post(
        f"/api/v1/vacancies/{vid}/candidates", headers=h, json={"candidateId": cand_id}
    )
    assert r1.status_code == 200
    match_id = r1.json()["id"]

    r2 = client.post(
        f"/api/v1/vacancies/{vid}/candidates", headers=h, json={"candidateId": cand_id}
    )
    assert r2.status_code == 200
    assert r2.json()["id"] == match_id  # тот же id — идемпотент


def test_engagement_type_mismatch_409(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)).json()["id"]
    vid = client.post(
        "/api/v1/vacancies",
        headers=h,
        json=_vac_payload(cid, account_manager_user.id, engagementType="agency"),
    ).json()["id"]
    cand_id = client.post(
        "/api/v1/candidates",
        headers=h,
        json=_cand_payload(recruiter_user.id, engagementType="outstaff"),
    ).json()["id"]

    r = client.post(
        f"/api/v1/vacancies/{vid}/candidates", headers=h, json={"candidateId": cand_id}
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "engagement_type_mismatch"


def test_match_patch_and_delete(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h, json=_client_payload(account_manager_user.id)).json()["id"]
    vid = client.post("/api/v1/vacancies", headers=h, json=_vac_payload(cid, account_manager_user.id)).json()["id"]
    cand_id = client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id)).json()["id"]
    match_id = client.post(
        f"/api/v1/vacancies/{vid}/candidates", headers=h, json={"candidateId": cand_id}
    ).json()["id"]

    r = client.patch(
        f"/api/v1/matches/{match_id}",
        headers=h,
        json={"status": "interview", "feedback": "позитивно"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "interview"

    r = client.delete(f"/api/v1/matches/{match_id}", headers=h)
    assert r.status_code == 200
    r = client.get(f"/api/v1/vacancies/{vid}/candidates", headers=h)
    assert r.json() == []


# ───── comments ─────


def test_comments_crud_and_author_only_edit(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h_admin, json=_client_payload(account_manager_user.id)).json()["id"]
    vid = client.post("/api/v1/vacancies", headers=h_admin, json=_vac_payload(cid, account_manager_user.id)).json()["id"]

    h_rec = auth_headers(client, recruiter_user.email)
    r = client.post(
        "/api/v1/comments",
        headers=h_rec,
        json={"entityType": "vacancy", "entityId": vid, "text": "первый коммент"},
    )
    assert r.status_code == 201
    comment_id = r.json()["id"]

    # list
    r = client.get(
        f"/api/v1/comments?entityType=vacancy&entityId={vid}", headers=h_rec
    )
    assert r.status_code == 200
    assert len(r.json()) == 1

    # admin может редактировать чужой
    r = client.patch(
        f"/api/v1/comments/{comment_id}",
        headers=h_admin,
        json={"text": "поправил"},
    )
    assert r.status_code == 200
    assert r.json()["text"] == "поправил"

    # account_manager (другой роль и не автор) — не может
    h_am = auth_headers(client, account_manager_user.email)
    r = client.patch(
        f"/api/v1/comments/{comment_id}", headers=h_am, json={"text": "взлом"}
    )
    assert r.status_code == 403

    # автор удаляет свой коммент
    r = client.delete(f"/api/v1/comments/{comment_id}", headers=h_rec)
    assert r.status_code == 200


def test_comment_mentions_create_notification(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    cid = client.post("/api/v1/clients", headers=h_admin, json=_client_payload(account_manager_user.id)).json()["id"]
    vid = client.post("/api/v1/vacancies", headers=h_admin, json=_vac_payload(cid, account_manager_user.id)).json()["id"]

    h_rec = auth_headers(client, recruiter_user.email)
    r = client.post(
        "/api/v1/comments",
        headers=h_rec,
        json={
            "entityType": "vacancy",
            "entityId": vid,
            "text": "Нужен фидбек от @AM",
            "mentions": [str(account_manager_user.id)],
        },
    )
    assert r.status_code == 201

    h_am = auth_headers(client, account_manager_user.email)
    notifications = client.get("/api/v1/notifications", headers=h_am)
    assert notifications.status_code == 200
    items = notifications.json()
    assert any(
        n["kind"] == "mention"
        and n["entityType"] == "vacancy"
        and n["entityId"] == vid
        for n in items
    )
