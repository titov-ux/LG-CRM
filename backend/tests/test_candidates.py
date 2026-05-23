"""Тесты /candidates."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def _cand_payload(recruiter_id, **overrides):
    p = {
        "fullName": "Иван Иванов",
        "role": "Backend",
        "engagementType": "outstaff",
        "grade": "Senior",
        "experienceYears": 7,
        "stack": ["Python", "FastAPI"],
        "rateMonth": 350000,
        "employmentType": "СМЗ",
        "format": "Удалённо",
        "location": "Москва",
        "recruiterId": str(recruiter_id),
        "status": "new",
        "email": "ivan@example.com",
        "phone": "+79991112233",
    }
    p.update(overrides)
    return p


def test_admin_creates_candidate(client: TestClient, admin_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["fullName"] == "Иван Иванов"
    assert body["stack"] == ["Python", "FastAPI"]
    assert body["archived"] is False


def test_duplicate_email_409(client: TestClient, admin_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id))
    r = client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id, fullName="Другой"))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "duplicate_candidate"


def test_filter_by_stack(client: TestClient, admin_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    client.post(
        "/api/v1/candidates",
        headers=h,
        json=_cand_payload(recruiter_user.id, email="a@x.ru", stack=["Python"]),
    )
    client.post(
        "/api/v1/candidates",
        headers=h,
        json=_cand_payload(recruiter_user.id, email="b@x.ru", stack=["Go"]),
    )
    r = client.get("/api/v1/candidates?stack=Python", headers=h)
    assert r.status_code == 200
    assert {c["fullName"] for c in r.json()["items"]} == {"Иван Иванов"}


def test_archive_and_restore(client: TestClient, admin_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id))
    cid = r.json()["id"]

    r = client.post(f"/api/v1/candidates/{cid}/archive", headers=h, json={"reason": "перерыв"})
    assert r.status_code == 200
    assert r.json()["archived"] is True

    # списком без архивных — пустой
    assert client.get("/api/v1/candidates", headers=h).json()["total"] == 0
    # archived=true
    assert client.get("/api/v1/candidates?archived=true", headers=h).json()["total"] == 1
    # archived=all
    assert client.get("/api/v1/candidates?archived=all", headers=h).json()["total"] == 1

    r = client.post(f"/api/v1/candidates/{cid}/restore", headers=h)
    assert r.status_code == 200
    assert r.json()["archived"] is False


def test_delete_default_archives(client: TestClient, admin_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id))
    cid = r.json()["id"]

    r = client.delete(f"/api/v1/candidates/{cid}", headers=h)
    assert r.status_code == 200
    # после dafault-DELETE кандидат архивирован, но не удалён
    r = client.get(f"/api/v1/candidates/{cid}", headers=h)
    assert r.status_code == 200
    assert r.json()["archived"] is True


def test_permanent_delete_admin_only(
    client: TestClient, admin_user, recruiter_user
) -> None:
    h_admin = auth_headers(client, admin_user.email)
    r = client.post("/api/v1/candidates", headers=h_admin, json=_cand_payload(recruiter_user.id))
    cid = r.json()["id"]

    h_rec = auth_headers(client, recruiter_user.email)
    r = client.delete(f"/api/v1/candidates/{cid}?permanent=true", headers=h_rec)
    assert r.status_code == 403

    r = client.delete(f"/api/v1/candidates/{cid}?permanent=true", headers=h_admin)
    assert r.status_code == 200
    r = client.get(f"/api/v1/candidates/{cid}", headers=h_admin)
    assert r.status_code == 404


def test_change_status_writes_audit_and_activity(
    client: TestClient, admin_user, recruiter_user
) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id))
    cid = r.json()["id"]

    r = client.patch(
        f"/api/v1/candidates/{cid}/status",
        headers=h,
        json={"status": "ready", "comment": "готов к презентации"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "ready"

    # activity: видим create + status
    r = client.get(f"/api/v1/candidates/{cid}/activity", headers=h)
    assert r.status_code == 200
    kinds = [a["kind"] for a in r.json()]
    assert "create" in kinds and "status" in kinds

    # audit: admin видит change
    r = client.get(f"/api/v1/audit?entityType=candidate&entityId={cid}", headers=h)
    assert r.status_code == 200
    rows = r.json()
    assert any(a["field"] == "status" and a["after"] == "ready" for a in rows)


def test_create_candidate_returns_201_if_activity_write_fails(
    client: TestClient, admin_user, recruiter_user, monkeypatch
) -> None:
    from app.modules.candidates import service as candidates_service

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("activity db failure")

    monkeypatch.setattr(candidates_service.audit_service, "record_activity", _boom)

    h = auth_headers(client, admin_user.email)
    r = client.post("/api/v1/candidates", headers=h, json=_cand_payload(recruiter_user.id))
    assert r.status_code == 201, r.text
    cid = r.json()["id"]

    # Карточка сохранена, даже если запись активности не удалась.
    r = client.get(f"/api/v1/candidates/{cid}", headers=h)
    assert r.status_code == 200
    assert r.json()["fullName"] == "Иван Иванов"
