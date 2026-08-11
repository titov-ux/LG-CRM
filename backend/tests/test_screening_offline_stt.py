"""Офлайн-STT после attach_audio / finish без live-сегментов."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.files.models import File, FileEntityType, ScanStatus
from app.modules.screening import report as screening_report
from app.modules.screening import service as screening_service
from app.modules.screening.models import (
    ScreeningSegment,
    ScreeningSession,
    ScreeningSpeaker,
    ScreeningStatus,
)
from tests.test_screening_analysis_ws import _patch_session_local


@pytest.mark.asyncio
async def test_maybe_start_offline_on_get_when_audio_without_transcript(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """GET сессии с записью и пустым транскриптом сам ставит офлайн-STT."""
    queued: list[uuid.UUID] = []

    def _capture(session, sid: uuid.UUID) -> None:
        queued.append(sid)

    monkeypatch.setattr(
        "app.modules.screening.service.enqueue_screening_offline_transcribe",
        _capture,
    )

    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.done,
        started_at=datetime.now(UTC),
        ended_at=datetime.now(UTC),
    )
    db.add(session)
    await db.flush()
    file = File(
        id=uuid.uuid4(),
        file_key=f"screening/{session.id}/rec.webm",
        original_name="rec.webm",
        mime="audio/webm",
        size=100,
        entity_type=FileEntityType.screening,
        entity_id=session.id,
        owner_user_id=recruiter_user.id,
        scan_status=ScanStatus.clean,
    )
    db.add(file)
    session.audio_file_id = file.id
    await db.commit()

    started = await screening_service.maybe_start_offline_transcription(db, session)
    assert started is True
    assert session.status == ScreeningStatus.processing
    assert queued == [session.id]

    # Пока processing — не дублируем.
    started_again = await screening_service.maybe_start_offline_transcription(
        db, session
    )
    assert started_again is False
    assert len(queued) == 1


@pytest.mark.asyncio
async def test_maybe_start_offline_skips_when_segments_exist(
    db: AsyncSession, recruiter_user, candidate
) -> None:
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
        size=100,
        entity_type=FileEntityType.screening,
        entity_id=session.id,
        owner_user_id=recruiter_user.id,
        scan_status=ScanStatus.clean,
    )
    db.add(file)
    session.audio_file_id = file.id
    db.add(
        ScreeningSegment(
            session_id=session.id,
            seq=1,
            speaker=ScreeningSpeaker.candidate,
            text_="уже есть",
            started_ms=0,
            ended_ms=500,
        )
    )
    await db.commit()

    assert (
        await screening_service.maybe_start_offline_transcription(db, session)
    ) is False
    assert session.status == ScreeningStatus.done


@pytest.mark.asyncio
async def test_insert_offline_segments_skips_when_live_exists(
    db: AsyncSession, recruiter_user, candidate
) -> None:
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
    )
    db.add(session)
    await db.flush()
    db.add(
        ScreeningSegment(
            session_id=session.id,
            seq=1,
            speaker=ScreeningSpeaker.recruiter,
            text_="уже есть",
            started_ms=0,
            ended_ms=500,
        )
    )
    await db.commit()

    n = await screening_service.insert_offline_segments(
        db,
        session.id,
        [{"text": "новое", "startedMs": 0, "endedMs": 1000}],
    )
    assert n == 0
    rows = (
        await db.execute(
            select(ScreeningSegment).where(ScreeningSegment.session_id == session.id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].text_ == "уже есть"


@pytest.mark.asyncio
async def test_insert_offline_segments_writes_candidate(
    db: AsyncSession, recruiter_user, candidate
) -> None:
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
    )
    db.add(session)
    await db.commit()

    n = await screening_service.insert_offline_segments(
        db,
        session.id,
        [
            {"text": "Привет", "startedMs": 100, "endedMs": 900},
            {"text": "  ", "startedMs": 0, "endedMs": 0},
            {"text": "Расскажите о себе", "startedMs": 1000, "endedMs": 2500},
        ],
    )
    assert n == 2
    rows = list(
        (
            await db.execute(
                select(ScreeningSegment)
                .where(ScreeningSegment.session_id == session.id)
                .order_by(ScreeningSegment.seq.asc())
            )
        )
        .scalars()
        .all()
    )
    assert [r.text_ for r in rows] == ["Привет", "Расскажите о себе"]
    assert all(r.speaker == ScreeningSpeaker.candidate for r in rows)


@pytest.mark.asyncio
async def test_attach_audio_triggers_offline_then_report(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """После attach на done без транскрипта — офлайн-STT и новый отчёт."""
    _patch_session_local(monkeypatch, db)
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.done,
        started_at=datetime.now(UTC),
        ended_at=datetime.now(UTC),
        duration_sec=60,
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

    async def _fake_offline(sid: uuid.UUID) -> int:
        assert sid == session.id
        return await screening_service.insert_offline_segments(
            db,
            session.id,
            [
                {
                    "text": "Кандидат рассказал про опыт в Python и командную работу.",
                    "startedMs": 0,
                    "endedMs": 4000,
                }
            ],
        )

    monkeypatch.setattr(screening_service, "run_offline_transcription", _fake_offline)

    from app.modules.screening.models import ScreeningVerdict

    async def _gen(**_kwargs):
        return {
            "summary": "Есть транскрипт после офлайн-STT.",
            "verdict": ScreeningVerdict.partial_fit,
            "scores": {"communication": 3},
            "red_flags": [],
            "recommendation": "Проверить детали",
            "model": "test",
            "prompt_version": "test",
        }

    monkeypatch.setattr(screening_report, "generate_screening_report", _gen)

    dto = await screening_service.attach_audio(
        db, recruiter_user, session.id, file.id
    )
    assert dto.audio_file_id == file.id
    # Eager: дождались offline+analysis.
    assert dto.status == ScreeningStatus.done

    segs = (
        await db.execute(
            select(ScreeningSegment).where(ScreeningSegment.session_id == session.id)
        )
    ).scalars().all()
    assert len(segs) == 1
    assert "Python" in segs[0].text_


@pytest.mark.asyncio
async def test_run_offline_transcription_downloads_and_transcribes(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    _patch_session_local(monkeypatch, db)
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
    )
    db.add(session)
    await db.flush()
    file = File(
        id=uuid.uuid4(),
        file_key=f"screening/{session.id}/rec.webm",
        original_name="rec.webm",
        mime="audio/webm",
        size=100,
        entity_type=FileEntityType.screening,
        entity_id=session.id,
        owner_user_id=recruiter_user.id,
        scan_status=ScanStatus.clean,
    )
    db.add(file)
    session.audio_file_id = file.id
    await db.commit()

    fake_s3 = MagicMock()
    fake_s3.download_bytes.return_value = b"fake-webm-bytes"
    monkeypatch.setattr(
        "app.integrations.s3.get_s3_adapter", lambda: fake_s3
    )

    async def _transcribe(audio: bytes, stt_url: str):
        assert audio == b"fake-webm-bytes"
        assert stt_url
        return [{"text": "Офлайн фраза", "startedMs": 0, "endedMs": 1200}]

    monkeypatch.setattr(
        "app.modules.screening.offline_stt.transcribe_audio_bytes",
        _transcribe,
    )
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "stt_url", "ws://stt:8765")

    n = await screening_service.run_offline_transcription(session.id)
    assert n == 1
    row = (
        await db.execute(
            select(ScreeningSegment).where(ScreeningSegment.session_id == session.id)
        )
    ).scalar_one()
    assert row.text_ == "Офлайн фраза"
    assert row.speaker == ScreeningSpeaker.candidate
