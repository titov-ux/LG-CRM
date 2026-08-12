"""Пост-анализ, attach_audio и WS-путь скрининга (дыры из ревью Этапа 6)."""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.candidates.models import Candidate
from app.modules.files.models import File, FileEntityType, ScanStatus
from app.modules.screening import metrics as screening_metrics
from app.modules.screening import report as screening_report
from app.modules.screening import service as screening_service
from app.modules.screening.models import (
    ScreeningReport,
    ScreeningSegment,
    ScreeningSession,
    ScreeningSpeaker,
    ScreeningStatus,
    ScreeningVerdict,
)
from app.modules.users.models import Role
from tests.conftest import _make_user, auth_headers


class _ReuseSession:
    """async-with обёртка над тестовой AsyncSession (SessionLocal в тестах)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def __aenter__(self) -> AsyncSession:
        return self._session

    async def __aexit__(self, *args: Any) -> bool:
        return False


def _patch_session_local(monkeypatch: pytest.MonkeyPatch, db: AsyncSession) -> None:
    """run_post_analysis / WS открывают SessionLocal — подменяем на тестовую БД."""
    monkeypatch.setattr(
        screening_service, "SessionLocal", lambda: _ReuseSession(db)
    )


@pytest_asyncio.fixture()
async def candidate(db: AsyncSession) -> Candidate:
    cand = Candidate(full_name="Anna Analysis", role="Backend")
    db.add(cand)
    await db.commit()
    await db.refresh(cand)
    return cand


@pytest_asyncio.fixture()
async def other_recruiter(db: AsyncSession):
    return await _make_user(
        db, "rec-other@lg.ru", "correct-horse-battery-staple", Role.recruiter, True
    )


def _token(client: TestClient, email: str) -> str:
    h = auth_headers(client, email)
    return h["Authorization"].removeprefix("Bearer ")


def _live_screening(client: TestClient, h: dict, candidate_id: str) -> dict:
    r = client.post(
        "/api/v1/screenings",
        headers=h,
        json={
            "candidateId": candidate_id,
            "questions": ["Опыт?"],
            "generateQuestions": False,
        },
    )
    assert r.status_code == 201, r.text
    s = r.json()
    assert (
        client.patch(
            f"/api/v1/screenings/{s['id']}",
            headers=h,
            json={"consentConfirmed": True},
        ).status_code
        == 200
    )
    r = client.post(f"/api/v1/screenings/{s['id']}/start", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "live"
    return r.json()


@pytest.mark.asyncio
async def test_run_post_analysis_fallback_on_ai_unavailable(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Этап 5: сбой AI → fallback-отчёт и status=done."""
    _patch_session_local(monkeypatch, db)
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
        started_at=datetime.now(UTC),
        ended_at=datetime.now(UTC),
        duration_sec=120,
    )
    db.add(session)
    await db.flush()
    db.add(
        ScreeningSegment(
            session_id=session.id,
            seq=1,
            speaker=ScreeningSpeaker.candidate,
            text_="Работал с Kafka три года на проде.",
            started_ms=0,
            ended_ms=3000,
        )
    )
    await db.commit()
    sid = session.id

    async def _boom(**kwargs):
        raise screening_report.AiUnavailableError("no key")

    monkeypatch.setattr(screening_report, "generate_screening_report", _boom)

    await screening_service.run_post_analysis(sid)

    await db.refresh(session)
    assert session.status == ScreeningStatus.done
    report = (
        await db.execute(
            select(ScreeningReport).where(ScreeningReport.session_id == sid)
        )
    ).scalar_one()
    assert report.model == "fallback"
    assert report.verdict == ScreeningVerdict.partial_fit


@pytest.mark.asyncio
async def test_run_post_analysis_fallback_on_empty_transcript(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Пустой транскрипт → fallback без вызова LLM (не анализ резюме)."""
    _patch_session_local(monkeypatch, db)
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
        started_at=datetime.now(UTC),
        ended_at=datetime.now(UTC),
        duration_sec=60,
    )
    db.add(session)
    await db.commit()
    sid = session.id

    called = {"n": 0}

    async def _should_not_run(**kwargs):
        called["n"] += 1
        raise AssertionError("LLM must not run on empty transcript")

    monkeypatch.setattr(screening_report, "generate_screening_report", _should_not_run)

    await screening_service.run_post_analysis(sid)

    await db.refresh(session)
    assert session.status == ScreeningStatus.done
    assert called["n"] == 0
    report = (
        await db.execute(
            select(ScreeningReport).where(ScreeningReport.session_id == sid)
        )
    ).scalar_one()
    assert report.model == "fallback"
    assert "почти нет" in report.summary


@pytest.mark.asyncio
async def test_run_post_analysis_sets_error_on_unexpected(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Неожиданный сбой пост-анализа → status=error, без отчёта."""
    _patch_session_local(monkeypatch, db)
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
        started_at=datetime.now(UTC),
        ended_at=datetime.now(UTC),
    )
    db.add(session)
    await db.commit()
    sid = session.id

    async def _boom(**kwargs):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(screening_report, "generate_screening_report", _boom)

    await screening_service.run_post_analysis(sid)

    await db.refresh(session)
    assert session.status == ScreeningStatus.error
    report = (
        await db.execute(
            select(ScreeningReport).where(ScreeningReport.session_id == sid)
        )
    ).scalar_one_or_none()
    assert report is None


@pytest.mark.asyncio
async def test_attach_audio_rejects_foreign_file(
    db: AsyncSession, recruiter_user, other_recruiter, candidate
) -> None:
    """Файл чужой сессии / другого entity нельзя привязать."""
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.done,
    )
    other = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=other_recruiter.id,
        status=ScreeningStatus.done,
    )
    db.add_all([session, other])
    await db.flush()
    foreign = File(
        id=uuid.uuid4(),
        file_key=f"screening/{other.id}/a.webm",
        original_name="a.webm",
        mime="audio/webm",
        size=10,
        entity_type=FileEntityType.screening,
        entity_id=other.id,
        owner_user_id=other_recruiter.id,
        scan_status=ScanStatus.clean,
    )
    wrong_type = File(
        id=uuid.uuid4(),
        file_key=f"screening/{session.id}/resume.pdf",
        original_name="resume.pdf",
        mime="application/pdf",
        size=10,
        entity_type=FileEntityType.screening,
        entity_id=session.id,
        owner_user_id=recruiter_user.id,
        scan_status=ScanStatus.clean,
    )
    db.add_all([foreign, wrong_type])
    await db.commit()

    from app.core.errors import ApiError

    with pytest.raises(ApiError) as mismatch:
        await screening_service.attach_audio(
            db, recruiter_user, session.id, foreign.id
        )
    assert mismatch.value.detail["code"] == "file_entity_mismatch"

    with pytest.raises(ApiError) as not_audio:
        await screening_service.attach_audio(
            db, recruiter_user, session.id, wrong_type.id
        )
    assert not_audio.value.detail["code"] == "file_not_audio"


@pytest.mark.asyncio
async def test_attach_audio_ok(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    _patch_session_local(monkeypatch, db)

    async def _noop_offline(_sid: uuid.UUID) -> int:
        return 0

    monkeypatch.setattr(screening_service, "run_offline_transcription", _noop_offline)

    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.done,
    )
    db.add(session)
    await db.flush()
    file = File(
        id=uuid.uuid4(),
        file_key=f"screening/{session.id}/rec.webm",
        original_name="rec.webm",
        mime="audio/webm",
        size=2048,
        entity_type=FileEntityType.screening,
        entity_id=session.id,
        owner_user_id=recruiter_user.id,
        scan_status=ScanStatus.clean,
    )
    db.add(file)
    await db.commit()

    dto = await screening_service.attach_audio(
        db, recruiter_user, session.id, file.id
    )
    assert dto.audio_file_id == file.id


def test_screening_ws_hello_and_rejects_draft(
    client: TestClient, recruiter_user, candidate, monkeypatch, db: AsyncSession
) -> None:
    """WS принимает live-сессию владельца и отдаёт hello; draft → 1008."""
    from app.api.v1.endpoints import screening_ws as ws_ep
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "stt_url", "")
    monkeypatch.setattr(ws_ep, "SessionLocal", lambda: _ReuseSession(db))

    h = auth_headers(client, recruiter_user.email)
    draft = client.post(
        "/api/v1/screenings",
        headers=h,
        json={
            "candidateId": str(candidate.id),
            "questions": ["x"],
            "generateQuestions": False,
        },
    ).json()
    token = _token(client, recruiter_user.email)

    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/ws/screening/{draft['id']}?token={token}"
        ) as ws:
            ws.receive_json()

    live = _live_screening(client, h, str(candidate.id))
    with client.websocket_connect(
        f"/api/v1/ws/screening/{live['id']}?token={token}"
    ) as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        assert hello["sessionId"] == live["id"]
        assert "lastSeq" in hello
        assert hello["sttReady"] is False
        ws.send_json({"type": "stop"})


def test_screening_ws_rejects_bad_token(
    client: TestClient, recruiter_user, candidate, monkeypatch, db: AsyncSession
) -> None:
    from app.api.v1.endpoints import screening_ws as ws_ep
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "stt_url", "")
    monkeypatch.setattr(ws_ep, "SessionLocal", lambda: _ReuseSession(db))
    h = auth_headers(client, recruiter_user.email)
    live = _live_screening(client, h, str(candidate.id))

    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/ws/screening/{live['id']}?token=not-a-jwt"
        ) as ws:
            ws.receive_json()


def test_metrics_prometheus_endpoint() -> None:
    screening_metrics.SCREENING_METRICS.reset()
    screening_metrics.record_stt_final(120.0)
    screening_metrics.session_opened()
    from app.main import app

    with TestClient(app) as c:
        r = c.get("/metrics")
    assert r.status_code == 200
    body = r.text
    assert "screening_stt_finals_total 1" in body
    assert "screening_active_sessions 1" in body
    assert "screening_stt_latency_ms" in body
    screening_metrics.session_closed()
    screening_metrics.SCREENING_METRICS.reset()


class _FakeSttWs:
    """Минимальный ClientConnection для SttBridge: send/close без сети."""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed = False

    async def send(self, data: Any) -> None:
        self.sent.append(data)

    async def close(self) -> None:
        self.closed = True


def _fake_bridge() -> tuple[Any, _FakeSttWs]:
    from app.modules.screening.stt_bridge import SttBridge

    async def _sink(_msg: dict[str, Any]) -> None:
        return None

    bridge = SttBridge("ws://stt.invalid", _sink)
    ws = _FakeSttWs()
    bridge._ws = ws
    return bridge, ws


@pytest.mark.asyncio
async def test_stt_bridge_stop_waits_for_flush_marker() -> None:
    """После stop мост ждёт {"type":"flushed"}, а не фиксированные 0.8 с.

    На CPU-small flush() в stt-service занимает секунды, и хвост финалов
    терялся вместе с разорванным соединением.
    """
    bridge, ws = _fake_bridge()
    task = asyncio.create_task(bridge.stop())
    await asyncio.sleep(0.1)
    assert not task.done()
    assert json.loads(ws.sent[0])["type"] == "stop"

    bridge._flushed.set()  # маркер от stt-service
    await asyncio.wait_for(task, 2.0)
    assert ws.closed is True


@pytest.mark.asyncio
async def test_stt_bridge_stop_falls_back_on_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Старый образ STT маркера не шлёт — отваливаемся по таймауту, как раньше."""
    from app.modules.screening import stt_bridge as bridge_mod

    monkeypatch.setattr(bridge_mod, "STOP_FLUSH_TIMEOUT_SEC", 0.05)
    bridge, ws = _fake_bridge()
    await asyncio.wait_for(bridge.stop(), 2.0)
    assert ws.closed is True
    assert bridge.connected is False
