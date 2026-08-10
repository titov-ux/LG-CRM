"""Тесты AI-скрининга: CRUD сессий, согласие, чек-лист, видимость."""
from __future__ import annotations

import pytest
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


def test_transcript_empty(client: TestClient, recruiter_user, candidate) -> None:
    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id))

    r = client.get(f"/api/v1/screenings/{s['id']}/transcript", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["lastSeq"] == 0


@pytest.mark.asyncio
async def test_append_segment_and_list_transcript(
    db: AsyncSession, recruiter_user, candidate
) -> None:
    """Этап 2: финальные сегменты пишутся с seq и отдаются в порядке."""
    from app.modules.screening import service as screening_service
    from app.modules.screening.models import ScreeningSpeaker
    from app.modules.screening.schemas import CreateScreeningRequest

    session = await screening_service.create(
        db,
        recruiter_user,
        CreateScreeningRequest(candidate_id=candidate.id, questions=["Q1"]),
    )
    empty = await screening_service.list_transcript(db, recruiter_user, session.id)
    assert empty.items == []
    assert empty.last_seq == 0

    s1 = await screening_service.append_segment(
        db,
        session.id,
        speaker=ScreeningSpeaker.candidate,
        text="Меня зовут Иван",
        started_ms=1000,
        ended_ms=2500,
    )
    s2 = await screening_service.append_segment(
        db,
        session.id,
        speaker=ScreeningSpeaker.recruiter,
        text="Расскажите про опыт",
        started_ms=3000,
        ended_ms=4500,
    )
    assert s1.seq == 1
    assert s2.seq == 2

    tr = await screening_service.list_transcript(db, recruiter_user, session.id)
    assert tr.last_seq == 2
    assert [x.text for x in tr.items] == ["Меня зовут Иван", "Расскажите про опыт"]
    assert [x.speaker.value for x in tr.items] == ["candidate", "recruiter"]


