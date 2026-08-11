"""E2E AI-скрининга — полный сценарий рекрутера.

Acceptance из плана (этапы 1–6, без браузерного захвата Телемоста):
  • создать сессию по кандидату+вакансии с AI-планом вопросов;
  • согласие → start → live;
  • WS hello (комната открыта);
  • финальные сегменты транскрипта (как от STT);
  • тик realtime-агента: answered + follow-up;
  • привязка аудиозаписи;
  • finish → пост-анализ → done + отчёт;
  • transcript/report API, уведомление и activity на кандидате.

YandexGPT и реальный STT мокаем: в CI нет ключей и Whisper.
"""
from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import ActivityEntry
from app.modules.files.models import File, FileEntityType, ScanStatus
from app.modules.screening import agent as screening_agent
from app.modules.screening import ai as screening_ai
from app.modules.screening import report as screening_report
from app.modules.screening import service as screening_service
from app.modules.screening.models import (
    ScreeningQuestionSource,
    ScreeningQuestionStatus,
    ScreeningSpeaker,
    ScreeningVerdict,
)
from app.modules.screening.report import SCORE_KEYS
from tests.conftest import auth_headers


class _ReuseSession:
    """async-with обёртка над тестовой AsyncSession (как в analysis_ws)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def __aenter__(self) -> AsyncSession:
        return self._session

    async def __aexit__(self, *args: Any) -> bool:
        return False


def _patch_session_local(monkeypatch: pytest.MonkeyPatch, db: AsyncSession) -> None:
    monkeypatch.setattr(
        screening_service, "SessionLocal", lambda: _ReuseSession(db)
    )


def _client_payload(am_id: uuid.UUID) -> dict:
    return {
        "name": "Screening E2E Client",
        "industry": "fintech",
        "accountManagerId": str(am_id),
        "status": "lead",
        "clientKind": "direct",
    }


def _vac_payload(client_id: str, am_id: uuid.UUID) -> dict:
    return {
        "title": "Python Backend",
        "clientId": client_id,
        "engagementType": "outstaff",
        "grade": "Middle",
        "format": "Удалённо",
        "rateClient": 2800,
        "positions": 1,
        "status": "in_work",
        "priority": "medium",
        "accountManagerId": str(am_id),
        "stack": ["Python", "PostgreSQL", "Kafka"],
    }


def _cand_payload(recruiter_id: uuid.UUID) -> dict:
    return {
        "fullName": "Анна Скринингова",
        "role": "Backend",
        "engagementType": "outstaff",
        "grade": "Middle",
        "experienceYears": 4,
        "stack": ["Python", "Kafka", "PostgreSQL"],
        "rateMonth": 280000,
        "employmentType": "СМЗ",
        "format": "Удалённо",
        "location": "Москва",
        "recruiterId": str(recruiter_id),
        "status": "ready",
        "email": "anna.screening@example.com",
    }


def _setup_match(
    client: TestClient, h: dict, am_id: uuid.UUID, recruiter_id: uuid.UUID
) -> tuple[str, str, str]:
    cid = client.post(
        "/api/v1/clients", headers=h, json=_client_payload(am_id)
    ).json()["id"]
    vid = client.post(
        "/api/v1/vacancies", headers=h, json=_vac_payload(cid, am_id)
    ).json()["id"]
    cand_id = client.post(
        "/api/v1/candidates", headers=h, json=_cand_payload(recruiter_id)
    ).json()["id"]
    match_id = client.post(
        f"/api/v1/vacancies/{vid}/candidates",
        headers=h,
        json={"candidateId": cand_id},
    ).json()["id"]
    return vid, cand_id, match_id


def _token(client: TestClient, email: str) -> str:
    return auth_headers(client, email)["Authorization"].removeprefix("Bearer ")


def _mock_report(**kwargs: Any) -> dict[str, Any]:
    segs = kwargs.get("segments") or []
    assert segs, "пост-анализ должен получить транскрипт"
    return {
        "summary": "Кандидат уверенно рассказал про Kafka и Postgres на проде.",
        "verdict": ScreeningVerdict.fit,
        "scores": {
            key: {"score": 4, "note": "по транскрипту"} for key in SCORE_KEYS
        },
        "red_flags": [],
        "recommendation": "Пригласить на техническое собеседование.",
        "model": "e2e-mock",
        "prompt_version": screening_report.PROMPT_VERSION,
    }


@pytest.mark.asyncio
async def test_full_screening_happy_path(
    client: TestClient,
    admin_user,
    account_manager_user,
    recruiter_user,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """create → AI-вопросы → live → STT → агент → audio → finish → отчёт."""
    h_admin = auth_headers(client, admin_user.email)
    h_rec = auth_headers(client, recruiter_user.email)
    vid, cand_id, match_id = _setup_match(
        client, h_admin, account_manager_user.id, recruiter_user.id
    )

    async def _fake_questions(**kwargs):
        assert kwargs.get("candidate_payload") is not None
        return [
            {
                "text": "Расскажите про последний проект на Kafka",
                "goal": "hard skills / messaging",
            },
            {
                "text": "Почему ищете новую роль?",
                "goal": "мотивация",
            },
            {
                "text": "Какой формат работы комфортен?",
                "goal": "условия",
            },
        ]

    monkeypatch.setattr(
        screening_ai, "generate_screening_questions", _fake_questions
    )

    # 1) Создание сессии: план вопросов от AI (ручных нет).
    r = client.post(
        "/api/v1/screenings",
        headers=h_rec,
        json={
            "candidateId": cand_id,
            "vacancyId": vid,
            "matchId": match_id,
            "telemostUrl": "https://telemost.yandex.ru/j/e2e-test",
            "questions": [],
            "generateQuestions": True,
        },
    )
    assert r.status_code == 201, r.text
    session = r.json()
    sid = session["id"]
    assert session["status"] == "draft"
    assert session["vacancyId"] == vid
    assert len(session["questions"]) == 3
    assert all(q["source"] == "pregenerated" for q in session["questions"])
    q0_id = session["questions"][0]["id"]

    # Без согласия start запрещён.
    r = client.post(f"/api/v1/screenings/{sid}/start", headers=h_rec)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "consent_required"

    r = client.patch(
        f"/api/v1/screenings/{sid}",
        headers=h_rec,
        json={"consentConfirmed": True},
    )
    assert r.status_code == 200

    r = client.post(f"/api/v1/screenings/{sid}/start", headers=h_rec)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "live"

    # 2) WS комнаты: hello при live (STT выключен — sttReady=false).
    from app.api.v1.endpoints import screening_ws as ws_ep
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "stt_url", "")
    monkeypatch.setattr(ws_ep, "SessionLocal", lambda: _ReuseSession(db))
    token = _token(client, recruiter_user.email)
    with client.websocket_connect(
        f"/api/v1/ws/screening/{sid}?token={token}"
    ) as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        assert hello["sessionId"] == sid
        assert hello["sttReady"] is False
        ws.send_json({"type": "stop"})

    # 3) Транскрипт (финалы STT) + тик агента (answered + follow-up).
    seg1 = await screening_service.append_segment(
        db,
        uuid.UUID(sid),
        speaker=ScreeningSpeaker.recruiter,
        text="Расскажите про последний проект на Kafka.",
        started_ms=0,
        ended_ms=2500,
    )
    seg2 = await screening_service.append_segment(
        db,
        uuid.UUID(sid),
        speaker=ScreeningSpeaker.candidate,
        text=(
            "Три года на проде: топики заказов, exactly-once через "
            "идемпотентный продюсер и Postgres outbox."
        ),
        started_ms=2600,
        ended_ms=12000,
    )
    assert seg1 is not None and seg2 is not None

    tick = screening_agent.AgentTickResult(
        updates=[
            screening_agent.AgentQuestionUpdate(
                id=uuid.UUID(q0_id),
                status=ScreeningQuestionStatus.answered,
                answer_summary="Kafka + outbox на Postgres, 3 года прода",
            )
        ],
        followups=[
            screening_agent.AgentFollowup(
                text="Как мониторили лаг консьюмеров?",
                goal="уточнить observability",
                insert_after_id=uuid.UUID(q0_id),
            )
        ],
        hint="Можно углубиться в мониторинг лага.",
    )
    questions, added_fu = await screening_agent.apply_agent_tick(
        db, uuid.UUID(sid), tick, max_followups_remaining=3
    )
    assert added_fu == 1
    answered = [q for q in questions if q.id == uuid.UUID(q0_id)][0]
    assert answered.status == ScreeningQuestionStatus.answered
    assert any(q.source == ScreeningQuestionSource.followup for q in questions)

    # 4) Аудиозапись (как после выгрузки MediaRecorder → /files).
    audio = File(
        id=uuid.uuid4(),
        file_key=f"screening/{sid}/rec.webm",
        original_name="rec.webm",
        mime="audio/webm",
        size=4096,
        entity_type=FileEntityType.screening,
        entity_id=uuid.UUID(sid),
        owner_user_id=recruiter_user.id,
        scan_status=ScanStatus.clean,
    )
    db.add(audio)
    await db.commit()

    r = client.post(
        f"/api/v1/screenings/{sid}/audio",
        headers=h_rec,
        json={"fileId": str(audio.id)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["audioFileId"] == str(audio.id)

    # 5) Finish: не гоняем фоновый SessionLocal на другой коннект —
    # анализ вызываем явно (в проде то же делает Celery-воркер).
    async def _noop_wait(timeout: float = 30.0) -> None:
        return None

    monkeypatch.setattr(
        screening_service, "wait_for_pending_analysis", _noop_wait
    )
    monkeypatch.setattr(
        screening_service, "enqueue_screening_analysis", lambda *a, **k: None
    )

    r = client.post(
        f"/api/v1/screenings/{sid}/finish",
        headers=h_rec,
        json={"durationSec": 1260},
    )
    assert r.status_code == 200, r.text
    finished = r.json()
    assert finished["status"] == "processing"
    assert finished["durationSec"] == 1260
    assert finished["endedAt"] is not None

    async def _fake_generate(**kwargs):
        return _mock_report(**kwargs)

    monkeypatch.setattr(
        screening_report, "generate_screening_report", _fake_generate
    )
    _patch_session_local(monkeypatch, db)
    await screening_service.run_post_analysis(uuid.UUID(sid))

    # 6) Итог: сессия done, отчёт, транскрипт, notify, activity.
    r = client.get(f"/api/v1/screenings/{sid}", headers=h_rec)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "done"
    assert body["report"] is not None
    assert body["report"]["verdict"] == "fit"
    assert body["report"]["model"] == "e2e-mock"
    assert "Kafka" in body["report"]["summary"]

    r = client.get(f"/api/v1/screenings/{sid}/report", headers=h_rec)
    assert r.status_code == 200
    report = r.json()
    assert report["verdict"] == "fit"
    assert report["recommendation"].startswith("Пригласить")
    assert set(report["scores"].keys()) == set(SCORE_KEYS)

    r = client.get(f"/api/v1/screenings/{sid}/transcript", headers=h_rec)
    assert r.status_code == 200
    tr = r.json()
    assert tr["lastSeq"] >= 2
    texts = [item["text"] for item in tr["items"]]
    assert any("Kafka" in t for t in texts)
    assert any(item["speaker"] == "candidate" for item in tr["items"])

    r = client.get(
        "/api/v1/screenings",
        headers=h_rec,
        params={"candidateId": cand_id, "status": "done"},
    )
    assert r.status_code == 200
    assert any(item["id"] == sid for item in r.json()["items"])

    notes = client.get("/api/v1/notifications", headers=h_rec).json()
    assert any(
        n.get("payload", {}).get("screeningId") == sid
        and n.get("payload", {}).get("verdict") == "fit"
        for n in notes
    ), notes

    acts = (
        await db.execute(
            select(ActivityEntry).where(
                ActivityEntry.entity_id == uuid.UUID(cand_id),
            )
        )
    ).scalars().all()
    assert any(
        a.text_
        and "AI-скрининг завершён" in a.text_
        and "подходит" in a.text_.lower()
        for a in acts
    ), [a.text_ for a in acts]

    # Идемпотентность пост-анализа: повторный вызов не ломает отчёт.
    await screening_service.run_post_analysis(uuid.UUID(sid))
    r = client.get(f"/api/v1/screenings/{sid}/report", headers=h_rec)
    assert r.status_code == 200
    assert r.json()["verdict"] == "fit"
