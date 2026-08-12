"""Этап 6: права screening:*, метрики, retention аудио."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.candidates.models import Candidate
from app.modules.files.models import File, FileEntityType, ScanStatus
from app.modules.permissions import service as permissions_service
from app.modules.screening import metrics as screening_metrics
from app.modules.screening import service as screening_service
from app.modules.screening.models import (
    ScreeningSession,
    ScreeningStatus,
    ScreeningVerdict,
)
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
    prom = screening_metrics.SCREENING_METRICS.to_prometheus()
    assert "screening_stt_finals_total 2" in prom
    assert 'screening_ai_agent_total{result="ok"} 1' in prom
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
async def test_purge_sweeps_orphan_screening_audio(
    db: AsyncSession, recruiter_user
) -> None:
    """Файл удалённой сессии не должен пережить retention (152-ФЗ).

    Сессии уже нет (или S3 упал при её удалении) — по сессиям такой объект не
    найти, поэтому его подметает вторая фаза purge_expired_audio.
    """
    old = datetime.now(UTC) - timedelta(days=120)
    ghost_session_id = uuid.uuid4()
    orphan_id = uuid.uuid4()
    fresh_id = uuid.uuid4()
    db.add_all(
        [
            File(
                id=orphan_id,
                file_key=f"screening/{ghost_session_id}/orphan.webm",
                original_name="orphan.webm",
                mime="audio/webm",
                size=100,
                entity_type=FileEntityType.screening,
                entity_id=ghost_session_id,
                owner_user_id=recruiter_user.id,
                scan_status=ScanStatus.clean,
                created_at=old,
            ),
            # Свежая сирота ещё в пределах retention — не трогаем.
            File(
                id=fresh_id,
                file_key=f"screening/{uuid.uuid4()}/fresh.webm",
                original_name="fresh.webm",
                mime="audio/webm",
                size=100,
                entity_type=FileEntityType.screening,
                entity_id=uuid.uuid4(),
                owner_user_id=recruiter_user.id,
                scan_status=ScanStatus.clean,
            ),
        ]
    )
    await db.commit()

    s3 = MagicMock()
    purged = await screening_service.purge_expired_audio(db, s3, retention_days=90)
    assert purged == 1
    s3.delete.assert_called_once()
    assert await db.get(File, orphan_id) is None
    assert await db.get(File, fresh_id) is not None


@pytest.mark.asyncio
async def test_purge_skips_when_retention_zero(db: AsyncSession) -> None:
    s3 = MagicMock()
    purged = await screening_service.purge_expired_audio(db, s3, retention_days=0)
    assert purged == 0
    s3.delete.assert_not_called()


@pytest.mark.asyncio
async def test_append_segment_drops_echo_and_non_live(
    db: AsyncSession, recruiter_user, candidate
) -> None:
    """Сегменты пишем только у live-сессии и без эха/галлюцинаций."""
    from app.modules.screening.models import ScreeningSpeaker

    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.live,
        started_at=datetime.now(UTC),
    )
    db.add(session)
    await db.commit()

    seg = await screening_service.append_segment(
        db,
        session.id,
        speaker=ScreeningSpeaker.candidate,
        text="Я работал с Kafka два года",
        started_ms=1000,
        ended_ms=4000,
    )
    assert seg is not None and seg.seq == 1

    # Эхо того же текста по каналу рекрутера — отбрасываем.
    echo = await screening_service.append_segment(
        db,
        session.id,
        speaker=ScreeningSpeaker.recruiter,
        text="я работал с kafka, два года",
        started_ms=1100,
        ended_ms=4100,
    )
    assert echo is None

    # Галлюцинация Whisper на тишине.
    junk = await screening_service.append_segment(
        db,
        session.id,
        speaker=ScreeningSpeaker.candidate,
        text="Продолжение следует...",
        started_ms=9000,
        ended_ms=9500,
    )
    assert junk is None

    # После завершения встречи писать в транскрипт нельзя.
    session.status = ScreeningStatus.processing
    await db.commit()
    late = await screening_service.append_segment(
        db,
        session.id,
        speaker=ScreeningSpeaker.candidate,
        text="Поздняя реплика",
        started_ms=20000,
        ended_ms=21000,
    )
    assert late is None


@pytest.mark.asyncio
async def test_close_stale_sessions_finishes_orphans(
    db: AsyncSession, recruiter_user, candidate
) -> None:
    """Рекрутер закрыл вкладку — сессия не должна висеть live навсегда."""
    stale = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.live,
        started_at=datetime.now(UTC) - timedelta(hours=2),
        last_seen_at=datetime.now(UTC) - timedelta(hours=1),
    )
    fresh = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.live,
        started_at=datetime.now(UTC),
        last_seen_at=datetime.now(UTC),
    )
    db.add_all([stale, fresh])
    await db.commit()

    closed = await screening_service.close_stale_sessions()
    assert closed >= 1

    await db.refresh(stale)
    await db.refresh(fresh)
    assert stale.status != ScreeningStatus.live
    assert stale.ended_at is not None
    assert fresh.status == ScreeningStatus.live


@pytest.mark.asyncio
async def test_orphan_grace_zero_keeps_live_session(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """SCREENING_ORPHAN_GRACE_MIN=0 = «не закрывать» (как написано в конфиге).

    Раньше `max(1, ...)` превращал ноль в «закрыть через минуту простоя».
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "screening_orphan_grace_min", 0)
    monkeypatch.setattr(settings, "screening_max_duration_min", 0)
    monkeypatch.setattr(settings, "screening_processing_timeout_min", 0)

    orphan = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.live,
        started_at=datetime.now(UTC) - timedelta(hours=3),
        last_seen_at=datetime.now(UTC) - timedelta(hours=2),
    )
    db.add(orphan)
    await db.commit()

    assert await screening_service.close_stale_sessions() == 0
    await db.refresh(orphan)
    assert orphan.status == ScreeningStatus.live


@pytest.mark.asyncio
async def test_sweeper_requeues_stuck_processing(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Сессия зависла в processing — уборщик один раз переставляет анализ."""
    requeued: list[uuid.UUID] = []

    async def _capture(_db, session) -> None:
        requeued.append(session.id)

    monkeypatch.setattr(screening_service, "_enqueue_post_meeting", _capture)
    settings = get_settings()
    monkeypatch.setattr(settings, "screening_orphan_grace_min", 0)
    monkeypatch.setattr(settings, "screening_max_duration_min", 0)
    monkeypatch.setattr(settings, "screening_processing_timeout_min", 30)

    old = datetime.now(UTC) - timedelta(minutes=45)
    stuck = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
        started_at=old,
        ended_at=old,
        updated_at=old,
    )
    db.add(stuck)
    await db.commit()

    screening_service._REQUEUED_PROCESSING.clear()
    try:
        await screening_service.close_stale_sessions()
        assert requeued.count(stuck.id) == 1
        # Второй проход беата (раз в минуту) задачу не дублирует.
        await screening_service.close_stale_sessions()
        assert requeued.count(stuck.id) == 1
    finally:
        screening_service._REQUEUED_PROCESSING.clear()

    await db.refresh(stuck)
    assert stuck.status == ScreeningStatus.processing


async def _fail_if_called(_db, session) -> None:
    raise AssertionError(
        f"анализ не должен переставляться для {session.id}: он уже безнадёжен"
    )


@pytest.mark.asyncio
async def test_sweeper_fails_long_stuck_processing(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Втрое дольше таймаута — сдаёмся: error + уведомление рекрутеру."""
    from app.modules.notifications.models import Notification

    monkeypatch.setattr(
        screening_service, "_enqueue_post_meeting", _fail_if_called
    )
    settings = get_settings()
    monkeypatch.setattr(settings, "screening_orphan_grace_min", 0)
    monkeypatch.setattr(settings, "screening_max_duration_min", 0)
    monkeypatch.setattr(settings, "screening_processing_timeout_min", 30)

    old = datetime.now(UTC) - timedelta(minutes=200)
    stuck = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
        started_at=old,
        ended_at=old,
        updated_at=old,
    )
    db.add(stuck)
    await db.commit()

    screening_service._REQUEUED_PROCESSING.clear()
    await screening_service.close_stale_sessions()

    await db.refresh(stuck)
    assert stuck.status == ScreeningStatus.error

    notes = list(
        (
            await db.execute(
                select(Notification).where(Notification.user_id == recruiter_user.id)
            )
        )
        .scalars()
        .all()
    )
    assert any(
        (n.payload or {}).get("screeningId") == str(stuck.id) for n in notes
    ), [n.text_ for n in notes]


@pytest.mark.asyncio
async def test_answer_summary_masked_without_view_report(
    client: TestClient,
    admin_user,
    account_manager_user,
    recruiter_user,
    candidate,
    db: AsyncSession,
) -> None:
    """Без `view_report` посторонний не видит ни отчёт, ни краткие ответы.

    `answer_summary` — тот же материал встречи, что транскрипт: раньше он
    утекал в списке и в карточке роли, у которой права на отчёт нет.
    """
    from app.modules.screening.models import ScreeningQuestion, ScreeningReport

    h = auth_headers(client, recruiter_user.email)
    s = _make_screening(client, h, str(candidate.id))
    session_id = uuid.UUID(s["id"])

    question = await db.get(ScreeningQuestion, uuid.UUID(s["questions"][0]["id"]))
    question.answer_summary = "5 лет на Python, вёл релизы"
    db.add(
        ScreeningReport(
            session_id=session_id,
            summary="Отчёт готов",
            verdict=ScreeningVerdict.fit,
            model="test",
        )
    )
    await db.commit()

    admin_h = auth_headers(client, admin_user.email)
    r = client.put(
        "/api/v1/permissions-matrix/screening.view_report",
        headers=admin_h,
        json={"matrix": {"recruiter": False, "account_manager": False}},
    )
    assert r.status_code == 200, r.text

    # Аккаунт-менеджер видит все сессии, но без права — без содержимого встречи.
    h_am = auth_headers(client, account_manager_user.email)
    r = client.get(f"/api/v1/screenings/{s['id']}", headers=h_am)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["report"] is None
    assert body["audioFileId"] is None
    assert body["questions"][0]["text"]  # сам вопрос остаётся
    assert body["questions"][0]["answerSummary"] is None

    r = client.get("/api/v1/screenings", headers=h_am)
    item = next(i for i in r.json()["items"] if i["id"] == s["id"])
    assert item["report"] is None
    assert item["questions"][0]["answerSummary"] is None

    # Ведущий рекрутер ведёт встречу и без права: свои пометки видит,
    # отчёт — нет (как и раньше).
    r = client.get(f"/api/v1/screenings/{s['id']}", headers=h)
    body = r.json()
    assert body["report"] is None
    assert body["questions"][0]["answerSummary"] == "5 лет на Python, вёл релизы"


@pytest.mark.asyncio
async def test_regenerate_questions_keeps_manual_ids(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Перегенерация не должна пересоздавать ручные вопросы (ломались id)."""
    from app.modules.screening import ai as screening_ai
    from app.modules.screening.models import (
        ScreeningQuestion,
        ScreeningQuestionSource,
    )
    from app.modules.screening.schemas import RegenerateQuestionsRequest

    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.draft,
    )
    session.questions.append(
        ScreeningQuestion(
            position=0, text_="Ручной вопрос", source=ScreeningQuestionSource.manual
        )
    )
    session.questions.append(
        ScreeningQuestion(
            position=1,
            text_="Старый AI-вопрос",
            source=ScreeningQuestionSource.pregenerated,
        )
    )
    db.add(session)
    await db.commit()
    manual_id = str(
        next(q.id for q in session.questions if q.source == ScreeningQuestionSource.manual)
    )

    async def _fake_generate(**kwargs):
        return [{"text": "Новый AI-вопрос", "goal": "проверить стек"}]

    monkeypatch.setattr(
        screening_ai, "generate_screening_questions", _fake_generate
    )

    dto = await screening_service.regenerate_questions(
        db, recruiter_user, session.id, RegenerateQuestionsRequest()
    )
    texts = [q.text for q in dto.questions]
    assert "Ручной вопрос" in texts
    assert "Старый AI-вопрос" not in texts
    assert "Новый AI-вопрос" in texts
    # id ручного вопроса сохранился — на него ссылаются фронт и агент.
    assert manual_id in {str(q.id) for q in dto.questions}
