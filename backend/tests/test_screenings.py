"""Тесты AI-скрининга: CRUD сессий, согласие, чек-лист, видимость."""
from __future__ import annotations

import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.candidates.models import Candidate
from app.modules.users.models import Role
from tests.conftest import _make_user, auth_headers


@pytest_asyncio.fixture()
async def candidate(db: AsyncSession) -> Candidate:
    cand = Candidate(full_name="Иван Тестов", role="Backend Developer")
    db.add(cand)
    await db.commit()
    await db.refresh(cand)
    return cand


@pytest_asyncio.fixture()
async def other_recruiter_user(db: AsyncSession):
    return await _make_user(
        db, "rec2@lg.ru", "correct-horse-battery-staple", Role.recruiter, True
    )


def _make_screening(client: TestClient, h: dict, candidate_id: str, **overrides) -> dict:
    payload = {
        "candidateId": candidate_id,
        "questions": ["Расскажите про опыт", "Почему ищете работу?"],
    }
    payload.update(overrides)
    r = client.post("/api/v1/screenings", headers=h, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_create_and_get(client: TestClient, recruiter_user, candidate) -> None:
    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(
        client, h, str(candidate.id), telemostUrl="https://telemost.yandex.ru/j/123"
    )

    assert s["status"] == "draft"
    assert s["recruiterId"] == str(recruiter_user.id)
    assert s["candidateName"] == "Иван Тестов"
    assert len(s["questions"]) == 2
    assert s["questions"][0]["source"] == "manual"

    r = client.get(f"/api/v1/screenings/{s['id']}", headers=h)
    assert r.status_code == 200
    assert r.json()["telemostUrl"] == "https://telemost.yandex.ru/j/123"


def test_start_requires_consent(client: TestClient, recruiter_user, candidate) -> None:
    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id))

    r = client.post(f"/api/v1/screenings/{s['id']}/start", headers=h)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "consent_required"

    r = client.patch(
        f"/api/v1/screenings/{s['id']}", headers=h, json={"consentConfirmed": True}
    )
    assert r.status_code == 200

    r = client.post(f"/api/v1/screenings/{s['id']}/start", headers=h)
    assert r.status_code == 200
    assert r.json()["status"] == "live"
    assert r.json()["startedAt"] is not None


def test_finish_sets_duration(client: TestClient, recruiter_user, candidate) -> None:
    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id))
    client.patch(f"/api/v1/screenings/{s['id']}", headers=h, json={"consentConfirmed": True})
    client.post(f"/api/v1/screenings/{s['id']}/start", headers=h)

    r = client.post(
        f"/api/v1/screenings/{s['id']}/finish", headers=h, json={"durationSec": 1830}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "done"
    assert body["durationSec"] == 1830
    assert body["endedAt"] is not None

    # Завершать draft нельзя.
    s2 = _make_screening(client, h, str(candidate.id))
    r = client.post(f"/api/v1/screenings/{s2['id']}/finish", headers=h, json={})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "invalid_status"


def test_questions_crud(client: TestClient, recruiter_user, candidate) -> None:
    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id), questions=[])

    r = client.post(
        f"/api/v1/screenings/{s['id']}/questions",
        headers=h,
        json={"text": "Какие БД использовали?", "goal": "Проверить hard skills"},
    )
    assert r.status_code == 200, r.text
    q = r.json()["questions"][0]
    assert q["text"] == "Какие БД использовали?"
    assert q["status"] == "pending"

    r = client.patch(
        f"/api/v1/screenings/{s['id']}/questions/{q['id']}",
        headers=h,
        json={"status": "answered"},
    )
    assert r.status_code == 200
    assert r.json()["questions"][0]["status"] == "answered"

    r = client.delete(f"/api/v1/screenings/{s['id']}/questions/{q['id']}", headers=h)
    assert r.status_code == 200
    assert r.json()["questions"] == []

    # Пустой вопрос — 422.
    r = client.post(
        f"/api/v1/screenings/{s['id']}/questions", headers=h, json={"text": "   "}
    )
    assert r.status_code == 422


def test_visibility_other_recruiter(
    client: TestClient, recruiter_user, other_recruiter_user, admin_user, candidate
) -> None:
    """Чужой рекрутер не видит сессию (404, существование не палим); admin видит."""
    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id))

    h2 = auth_headers(client, other_recruiter_user.email)
    r = client.get(f"/api/v1/screenings/{s['id']}", headers=h2)
    assert r.status_code == 404

    r = client.get("/api/v1/screenings", headers=h2)
    assert r.json()["total"] == 0

    ha = auth_headers(client, admin_user.email)
    r = client.get(f"/api/v1/screenings/{s['id']}", headers=ha)
    assert r.status_code == 200


def test_delete_only_owner_or_admin(
    client: TestClient, recruiter_user, other_recruiter_user, admin_user, candidate
) -> None:
    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id))

    h2 = auth_headers(client, other_recruiter_user.email)
    r = client.delete(f"/api/v1/screenings/{s['id']}", headers=h2)
    assert r.status_code == 403

    ha = auth_headers(client, admin_user.email)
    r = client.delete(f"/api/v1/screenings/{s['id']}", headers=ha)
    assert r.status_code == 200

    r = client.get(f"/api/v1/screenings/{s['id']}", headers=h)
    assert r.status_code == 404


async def test_segments_transcript(
    client: TestClient, recruiter_user, other_recruiter_user, candidate, db
) -> None:
    """GET /segments отдаёт транскрипт по порядку seq; чужому — 404."""
    import uuid as uuid_mod

    from app.modules.screening.models import ScreeningSegment, ScreeningSpeaker

    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id))

    db.add_all([
        ScreeningSegment(
            session_id=uuid_mod.UUID(s["id"]), seq=2,
            speaker=ScreeningSpeaker.candidate,
            text_="Ответ кандидата", started_ms=5000, ended_ms=9000,
        ),
        ScreeningSegment(
            session_id=uuid_mod.UUID(s["id"]), seq=1,
            speaker=ScreeningSpeaker.recruiter,
            text_="Вопрос рекрутера", started_ms=0, ended_ms=4000,
        ),
    ])
    await db.commit()

    r = client.get(f"/api/v1/screenings/{s['id']}/segments", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [seg["seq"] for seg in body] == [1, 2]
    assert body[0]["speaker"] == "recruiter"
    assert body[0]["text"] == "Вопрос рекрутера"

    h2 = auth_headers(client, other_recruiter_user.email)
    r = client.get(f"/api/v1/screenings/{s['id']}/segments", headers=h2)
    assert r.status_code == 404


def test_list_filters(client: TestClient, recruiter_user, candidate) -> None:
    h = auth_headers(client, recruiter_user.email)
    _make_screening(client, h, str(candidate.id))
    _make_screening(client, h, str(candidate.id))

    r = client.get(
        "/api/v1/screenings", headers=h, params={"candidateId": str(candidate.id)}
    )
    assert r.status_code == 200
    assert r.json()["total"] == 2

    r = client.get("/api/v1/screenings", headers=h, params={"status": "live"})
    assert r.json()["total"] == 0
