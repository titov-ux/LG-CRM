"""Офлайн-STT после attach_audio / finish без live-сегментов."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.files.models import File, FileEntityType, ScanStatus
from app.modules.notifications.models import Notification
from app.modules.permissions import service as permissions_service
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
from tests.test_screening_analysis_ws import (  # noqa: F401
    _patch_session_local,
    candidate,  # fixture: pytest ищет её по имени в этом модуле
)


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

    # Пока processing и cooldown не истёк — авто не дублируем.
    started_again = await screening_service.maybe_start_offline_transcription(
        db, session
    )
    assert started_again is False
    assert len(queued) == 1

    # Явный force (кнопка / attach) — перезапускаем даже в processing.
    started_force = await screening_service.maybe_start_offline_transcription(
        db, session, force=True
    )
    assert started_force is True
    assert len(queued) == 2


@pytest.mark.asyncio
async def test_get_starts_offline_only_for_session_runner(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """GET остаётся чтением для того, кто не может вести сессию.

    Авто-офлайн-STT меняет статус и жжёт STT+LLM — запускать его вправе только
    ведущий/админ с действующим `screening:run`.
    """
    from app.modules.permissions.models import PermissionRow

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
    session_id = session.id

    # Матрица сидируется лениво — дёргаем её перед правкой строки.
    await permissions_service.list_matrix(db)
    row = await db.get(PermissionRow, "screening.run")
    row.matrix = {**(row.matrix or {}), "recruiter": False}
    await db.commit()

    dto = await screening_service.get(db, recruiter_user, session_id)
    assert dto.status == ScreeningStatus.done
    assert queued == []

    row = await db.get(PermissionRow, "screening.run")
    row.matrix = {**(row.matrix or {}), "recruiter": True}
    await db.commit()

    dto = await screening_service.get(db, recruiter_user, session_id)
    assert dto.status == ScreeningStatus.processing
    assert queued == [session_id]


@pytest.mark.asyncio
async def test_run_post_analysis_marks_error_when_report_write_fails(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Сбой на записи отчёта не должен оставлять сессию в processing навсегда."""
    _patch_session_local(monkeypatch, db)
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
        started_at=datetime.now(UTC),
        ended_at=datetime.now(UTC),
    )
    db.add(session)
    await db.flush()
    db.add(
        ScreeningSegment(
            session_id=session.id,
            seq=1,
            speaker=ScreeningSpeaker.candidate,
            text_="Достаточно длинный ответ кандидата про опыт и стек, чтобы пройти порог.",
            started_ms=0,
            ended_ms=4000,
        )
    )
    await db.commit()
    # Внутри обработчика сбоя есть rollback — снимаем id заранее, чтобы не
    # ходить в БД за просроченными атрибутами ORM-объектов.
    session_id = session.id
    recruiter_id = recruiter_user.id

    async def _gen(**_kwargs):
        return {
            "summary": "Ок",
            "verdict": ScreeningVerdict.partial_fit,
            "scores": {"communication": {"score": 3, "note": "норм"}},
            "red_flags": [],
            "recommendation": "Созвон",
            "model": "test",
            "prompt_version": "test",
        }

    monkeypatch.setattr(screening_report, "generate_screening_report", _gen)

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("DB упала на записи отчёта")

    monkeypatch.setattr(screening_service, "_persist_report", _boom)

    # Ошибка не должна улететь наружу: её всё равно проглотят в tasks.py.
    await screening_service.run_post_analysis(session_id)

    await db.refresh(session)
    assert session.status == ScreeningStatus.error
    assert (
        await db.execute(
            select(ScreeningReport).where(ScreeningReport.session_id == session_id)
        )
    ).scalar_one_or_none() is None

    notes = list(
        (
            await db.execute(
                select(Notification).where(Notification.user_id == recruiter_id)
            )
        )
        .scalars()
        .all()
    )
    assert any(
        (n.payload or {}).get("screeningId") == str(session_id) for n in notes
    ), [n.text_ for n in notes]


@pytest.mark.asyncio
async def test_persist_report_survives_parallel_insert(
    db: AsyncSession, recruiter_user, candidate
) -> None:
    """Гонка finish → анализ и GET → офлайн-STT: UNIQUE(session_id) не 500-ит."""
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
    )
    db.add(session)
    await db.commit()

    raw = {
        "summary": "Первый",
        "verdict": ScreeningVerdict.partial_fit,
        "scores": None,
        "red_flags": [],
        "recommendation": None,
        "model": "test",
        "prompt_version": "test",
    }
    await screening_service._persist_report(db, session.id, raw, existing=None)
    await db.commit()

    # Второй писатель тоже считает, что отчёта нет (existing=None) — должен
    # обновить чужую строку, а не упасть на UNIQUE.
    await screening_service._persist_report(
        db, session.id, {**raw, "summary": "Второй"}, existing=None
    )
    await db.commit()

    reports = list(
        (
            await db.execute(
                select(ScreeningReport).where(ScreeningReport.session_id == session.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(reports) == 1
    assert reports[0].summary == "Второй"


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


@pytest.mark.asyncio
async def test_maybe_start_skips_when_report_exists(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Авто-GET не перезапускает офлайн-STT, если LLM-отчёт уже есть (анти-spam)."""
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
    db.add(
        ScreeningReport(
            session_id=session.id,
            summary="Готово",
            verdict=ScreeningVerdict.partial_fit,
            model="yandexgpt",
        )
    )
    await db.commit()

    assert (
        await screening_service.maybe_start_offline_transcription(db, session)
    ) is False
    assert queued == []
    assert session.status == ScreeningStatus.done

    # Явная кнопка — можно.
    assert (
        await screening_service.maybe_start_offline_transcription(
            db, session, force=True
        )
    ) is True
    assert queued == [session.id]
    assert session.status == ScreeningStatus.processing


@pytest.mark.asyncio
async def test_maybe_start_retries_fallback_report_after_cooldown(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Fallback-отчёт при пустом транскрипте не блокирует авто-офлайн навсегда."""
    queued: list[uuid.UUID] = []

    def _capture(session, sid: uuid.UUID) -> None:
        queued.append(sid)

    monkeypatch.setattr(
        "app.modules.screening.service.enqueue_screening_offline_transcribe",
        _capture,
    )

    old = datetime.now(UTC) - timedelta(minutes=20)
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.done,
        started_at=old,
        ended_at=old,
        updated_at=old,
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
        ScreeningReport(
            session_id=session.id,
            summary="На встрече почти нет зафиксированных ответов",
            verdict=ScreeningVerdict.partial_fit,
            model="fallback",
        )
    )
    await db.commit()

    assert (
        await screening_service.maybe_start_offline_transcription(db, session)
    ) is True
    assert queued == [session.id]
    assert session.status == ScreeningStatus.processing


@pytest.mark.asyncio
async def test_maybe_start_fallback_respects_cooldown(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Свежий fallback не должен штормить очередь на каждом GET."""
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
    db.add(
        ScreeningReport(
            session_id=session.id,
            summary="заглушка",
            verdict=ScreeningVerdict.partial_fit,
            model="fallback",
        )
    )
    await db.commit()

    assert (
        await screening_service.maybe_start_offline_transcription(db, session)
    ) is False
    assert queued == []

    assert (
        await screening_service.maybe_start_offline_transcription(
            db, session, force=True
        )
    ) is True
    assert queued == [session.id]


@pytest.mark.asyncio
async def test_replace_report_does_not_spam_notifications(
    db: AsyncSession, recruiter_user, candidate, monkeypatch
) -> None:
    """Повторный анализ с replace_report не плодит колокольчики."""
    _patch_session_local(monkeypatch, db)
    session = ScreeningSession(
        candidate_id=candidate.id,
        recruiter_id=recruiter_user.id,
        status=ScreeningStatus.processing,
        started_at=datetime.now(UTC),
        ended_at=datetime.now(UTC),
    )
    db.add(session)
    await db.flush()
    db.add(
        ScreeningSegment(
            session_id=session.id,
            seq=1,
            speaker=ScreeningSpeaker.candidate,
            text_="Достаточно длинный ответ кандидата про опыт и стек, чтобы пройти порог.",
            started_ms=0,
            ended_ms=4000,
        )
    )
    await db.commit()

    async def _gen(**_kwargs):
        return {
            "summary": "Ок",
            "verdict": ScreeningVerdict.partial_fit,
            "scores": {"communication": {"score": 3, "note": "норм"}},
            "red_flags": [],
            "recommendation": "Созвон",
            "model": "test",
            "prompt_version": "test",
        }

    monkeypatch.setattr(screening_report, "generate_screening_report", _gen)

    await screening_service.run_post_analysis(session.id)
    await screening_service.run_post_analysis(session.id, replace_report=True)
    await screening_service.run_post_analysis(session.id, replace_report=True)

    notes = list(
        (
            await db.execute(
                select(Notification).where(Notification.user_id == recruiter_user.id)
            )
        )
        .scalars()
        .all()
    )
    screening_notes = [
        n
        for n in notes
        if (n.payload or {}).get("screeningId") == str(session.id)
    ]
    assert len(screening_notes) == 1, [n.text_ for n in screening_notes]


@pytest.mark.asyncio
async def test_insert_offline_segments_keeps_roles_and_order(
    db: AsyncSession, recruiter_user, candidate
) -> None:
    """Стерео-запись: роли берутся из дорожек, порядок — по времени.

    Сегменты двух дорожек приходят вперемешку (каждая распознаётся своим
    окном), поэтому seq обязан считаться уже после сортировки — иначе в UI
    ответ кандидата встанет раньше вопроса рекрутёра.
    """
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
            {
                "text": "Я работал с Python пять лет",
                "speaker": "candidate",
                "startedMs": 2000,
                "endedMs": 5000,
            },
            {
                "text": "Расскажите о своём опыте",
                "speaker": "recruiter",
                "startedMs": 100,
                "endedMs": 1800,
            },
            {
                "text": "Понятно, спасибо",
                "speaker": "неизвестно",
                "startedMs": 6000,
                "endedMs": 7000,
            },
        ],
    )
    assert n == 3
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
    assert [r.speaker for r in rows] == [
        ScreeningSpeaker.recruiter,
        ScreeningSpeaker.candidate,
        # Мусорная роль не должна ронять вставку — падаем на дефолт.
        ScreeningSpeaker.candidate,
    ]
    assert [r.started_ms for r in rows] == [100, 2000, 6000]


@pytest.mark.asyncio
async def test_transcribe_tracks_requests_batch_mode(monkeypatch) -> None:
    """Офлайн идёт в stt-service батчем и сохраняет роль каждой дорожки."""
    from app.modules.screening import offline_stt

    sent_controls: list[dict] = []
    sent_channels: list[int] = []

    class _FakeBridge:
        def __init__(self, url: str, on_event) -> None:
            self.on_event = on_event

        async def connect(self) -> None:
            return None

        async def send_pcm(self, data: bytes) -> None:
            sent_channels.append(data[0])

        async def send_control(self, msg: dict) -> None:
            sent_controls.append(msg)
            if msg.get("type") == "mode":
                await self.on_event({"type": "mode", "mode": msg.get("mode")})
            elif msg.get("type") == "stop":
                await self.on_event(
                    {
                        "type": "transcript.final",
                        "speaker": "recruiter",
                        "text": "Расскажите о себе",
                        "startedMs": 0,
                        "endedMs": 1500,
                    }
                )
                await self.on_event(
                    {
                        "type": "transcript.final",
                        "speaker": "candidate",
                        "text": "Я дата-инженер",
                        "startedMs": 1600,
                        "endedMs": 4000,
                    }
                )
                await self.on_event({"type": "stats", "channels": []})

        async def close(self) -> None:
            return None

    monkeypatch.setattr(offline_stt, "SttBridge", _FakeBridge)

    silence = b"\x00\x00" * offline_stt.SAMPLE_RATE  # 1 с
    items = await offline_stt.transcribe_tracks_via_stt(
        {0: silence, 1: silence}, "ws://stt:8765"
    )

    assert sent_controls[0] == {"type": "mode", "mode": "batch"}
    assert sent_controls[-1] == {"type": "stop"}
    # Обе дорожки уехали в свой канал stt-service.
    assert set(sent_channels) == {0, 1}
    assert [(i["speaker"], i["text"]) for i in items] == [
        ("recruiter", "Расскажите о себе"),
        ("candidate", "Я дата-инженер"),
    ]
