"""Этап 6: права screening:*, метрики, retention аудио."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.candidates.models import Candidate
from app.modules.files.models import File, FileEntityType, ScanStatus
from app.modules.permissions import service as permissions_service
from app.modules.screening import metrics as screening_metrics
from app.modules.screening import service as screening_service
from app.modules.screening.models import ScreeningSession, ScreeningStatus
from app.modules.users.models import Role
from tests.conftest import _make_user, auth_headers


@pytest_asyncio.fixture()
async def candidate(db: AsyncSession) -> Candidate:
    cand = Candidate(full_name="Petr Screening", role="QA")
    db.add(cand)
    await db.commit()
    await db.refresh(cand)
    return cand


@pytest_asyncio.fixture()
async def viewer_user(db: AsyncSession):
    return await _make_user(
        db, "viewer@lg.ru", "correct-horse-battery-staple", Role.viewer, True
    )


def _make_screening(client: TestClient, h: dict, candidate_id: str) -> dict:
    r = client.post(
        "/api/v1/screenings",
        headers=h,
        json={
            "candidateId": candidate_id,
            "questions": ["Opyt?"],
            "generateQuestions": False,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_viewer_cannot_create_screening(
    client: TestClient, viewer_user, candidate
) -> None:
    h = auth_headers(client, viewer_user.email)
    r = client.post(
        "/api/v1/screenings",
        headers=h,
        json={
            "candidateId": str(candidate.id),
            "questions": ["x"],
            "generateQuestions": False,
        },
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


def test_matrix_denies_run_for_recruiter(
    client: TestClient, admin_user, recruiter_user, candidate
) -> None:
    admin_h = auth_headers(client, admin_user.email)
    client.put(
        "/api/v1/permissions-matrix/screening.run",
        headers=admin_h,
        json={"matrix": {"recruiter": False}},
    )
    h = auth_headers(client, recruiter_user.email)
    r = client.post(
        "/api/v1/screenings",
        headers=h,
        json={
            "candidateId": str(candidate.id),
            "questions": ["x"],
            "generateQuestions": False,
        },
    )
    assert r.status_code == 403


def test_view_report_required_for_transcript(
    client: TestClient, admin_user, recruiter_user, candidate
) -> None:
    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id))

    admin_h = auth_headers(client, admin_user.email)
    client.put(
        "/api/v1/permissions-matrix/screening.view_report",
        headers=admin_h,
        json={"matrix": {"recruiter": False}},
    )

    r = client.get(f"/api/v1/screenings/{s['id']}/transcript", headers=h)
    assert r.status_code == 403

    r = client.get(f"/api/v1/screenings/{s['id']}/report", headers=h)
    assert r.status_code == 403


def test_permissions_matrix_has_screening_rows(
    client: TestClient, recruiter_user
) -> None:
    h = auth_headers(client, recruiter_user.email)
    r = client.get("/api/v1/permissions-matrix", headers=h)
    assert r.status_code == 200
    ids = {p["id"] for p in r.json()["items"]}
    assert "screening.run" in ids
    assert "screening.view_report" in ids


def test_screening_metrics_counters() -> None:
    screening_metrics.SCREENING_METRICS.reset()
    screening_metrics.record_stt_final(100.0)
    screening_metrics.record_stt_final(300.0)
    screening_metrics.record_stt_error("busy")
    screening_metrics.record_ai_agent_ok()
    screening_metrics.record_ai_agent_unavailable()
    screening_metrics.record_ai_report_fallback()
    screening_metrics.record_retention_purged(2)
    screening_metrics.record_max_duration_stop()
    snap = screening_metrics.SCREENING_METRICS.snapshot()
    assert snap["stt_finals"] == 2
    assert snap["stt_avg_latency_ms"] == 200.0
    assert snap["stt_errors"] == 1
    assert snap["ai_agent_ok"] == 1
    assert snap["ai_agent_unavailable"] == 1
    assert snap["ai_report_fallback"] == 1
    assert snap["retention_purged"] == 2
    assert snap["max_duration_stops"] == 1
    screening_metrics.SCREENING_METRICS.reset()


@pytest.mark.asyncio
async def test_user_has_action_from_matrix(db: AsyncSession, recruiter_user) -> None:
    assert await permissions_service.user_has_action(
        db, recruiter_user, "screening:run"
    )
    assert await permissions_service.user_has_action(
        db, recruiter_user, "screening:view_report"
    )


@pytest.mark.asyncio
async def test_purge_expired_audio(db: AsyncSession, recruiter_user, candidate) -> None:
    old = datetime.now(UTC) - timedelta(days=120)
    session_id = uuid.uuid4()
    file_id = uuid.uuid4()
    db.add(
        File(
            id=file_id,
            file_key=f"screening/{session_id}/old.webm",
            original_name="old.webm",
            mime="audio/webm",
            size=100,
            entity_type=FileEntityType.screening,
            entity_id=session_id,
            owner_user_id=recruiter_user.id,
            scan_status=ScanStatus.clean,
        )
    )
    session = ScreeningSession(
        id=session_id,
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.done,
        audio_file_id=file_id,
        ended_at=old,
    )
    db.add(session)
    await db.commit()

    s3 = MagicMock()
    purged = await screening_service.purge_expired_audio(db, s3, retention_days=90)
    assert purged == 1
    s3.delete.assert_called_once()

    await db.refresh(session)
    assert session.audio_file_id is None
    assert await db.get(File, file_id) is None


@pytest.mark.asyncio
async def test_purge_skips_when_retention_zero(db: AsyncSession) -> None:
    s3 = MagicMock()
    purged = await screening_service.purge_expired_audio(db, s3, retention_days=0)
    assert purged == 0
    s3.delete.assert_not_called()
