"""Сервис AI-скрининга: сессии, чек-лист вопросов, привязка записи.

Бизнес-правила Этапа 1:
* создать сессию может admin / account_manager / recruiter; ведущим
  (`recruiter_id`) становится автор;
* видимость: admin и account_manager видят все сессии; остальные — только
  свои (где они ведущие) и сессии по вакансиям, где они назначены;
* переход draft → live требует `consent_confirmed=true` (409 consent_required):
  запись разговора без согласия кандидата не начинаем (152-ФЗ);
* finish: live → done (на Этапе 5 здесь появится Celery-пост-анализ и
  промежуточный статус processing);
* удалять сессию может ведущий или admin.

Этап 3: генерация / перегенерация плана вопросов через YandexGPT
(`screening/ai.py`) по резюме кандидата и полям вакансии.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from fastapi import status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ApiError, Forbidden, NotFound
from app.modules.candidates.models import Candidate
from app.modules.files.models import File, FileEntityType
from app.modules.matching.models import VacancyCandidate
from app.modules.matching.service import candidate_payload, vacancy_payload
from app.modules.screening import ai as screening_ai
from app.modules.screening.models import (
    ScreeningQuestion,
    ScreeningQuestionSource,
    ScreeningReport,
    ScreeningSegment,
    ScreeningSession,
    ScreeningSpeaker,
    ScreeningStatus,
)
from app.modules.screening.schemas import (
    AddQuestionRequest,
    CreateScreeningRequest,
    FinishScreeningRequest,
    RegenerateQuestionsRequest,
    ScreeningListResponse,
    ScreeningQuestionDTO,
    ScreeningReportDTO,
    ScreeningSegmentDTO,
    ScreeningSessionResponse,
    TranscriptResponse,
    UpdateQuestionRequest,
    UpdateScreeningRequest,
)
from app.modules.users.models import Role, User
from app.modules.vacancies.models import Vacancy, VacancyRecruiter

logger = logging.getLogger(__name__)

_CREATOR_ROLES = (Role.admin, Role.account_manager, Role.recruiter)
_SEE_ALL_ROLES = (Role.admin, Role.account_manager)


# --- helpers ---------------------------------------------------------------


async def _load(db: AsyncSession, session_id: uuid.UUID) -> ScreeningSession:
    session = (
        await db.execute(
            select(ScreeningSession)
            .where(ScreeningSession.id == session_id)
            .options(selectinload(ScreeningSession.questions))
        )
    ).scalar_one_or_none()
    if session is None:
        raise NotFound("Сессия скрининга не найдена")
    return session


async def _ensure_can_see(db: AsyncSession, user: User, s: ScreeningSession) -> None:
    if user.role in _SEE_ALL_ROLES or s.recruiter_id == user.id:
        return
    if s.vacancy_id is not None:
        assigned = await db.get(VacancyRecruiter, (s.vacancy_id, user.id))
        if assigned is not None:
            return
    raise NotFound("Сессия скрининга не найдена")  # не палим существование


def _ensure_can_edit(user: User, s: ScreeningSession) -> None:
    if user.role == Role.admin or s.recruiter_id == user.id:
        return
    raise Forbidden("Изменять сессию может ведущий рекрутер или админ")


async def _names_for(
    db: AsyncSession, sessions: list[ScreeningSession]
) -> tuple[dict[uuid.UUID, str], dict[uuid.UUID, str], dict[uuid.UUID, str]]:
    cand_ids = {s.candidate_id for s in sessions}
    vac_ids = {s.vacancy_id for s in sessions if s.vacancy_id}
    rec_ids = {s.recruiter_id for s in sessions if s.recruiter_id}

    cand_names: dict[uuid.UUID, str] = {}
    if cand_ids:
        rows = await db.execute(
            select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(cand_ids))
        )
        cand_names = dict(rows.all())

    vac_titles: dict[uuid.UUID, str] = {}
    if vac_ids:
        rows = await db.execute(
            select(Vacancy.id, Vacancy.title).where(Vacancy.id.in_(vac_ids))
        )
        vac_titles = dict(rows.all())

    rec_names: dict[uuid.UUID, str] = {}
    if rec_ids:
        rows = await db.execute(
            select(User.id, User.full_name).where(User.id.in_(rec_ids))
        )
        rec_names = dict(rows.all())

    return cand_names, vac_titles, rec_names


def _question_dto(q: ScreeningQuestion) -> ScreeningQuestionDTO:
    return ScreeningQuestionDTO(
        id=q.id,
        position=q.position,
        text=q.text_,
        goal=q.goal,
        source=q.source,
        status=q.status,
        answer_summary=q.answer_summary,
    )


def _to_dto(
    s: ScreeningSession,
    *,
    cand_names: dict[uuid.UUID, str],
    vac_titles: dict[uuid.UUID, str],
    rec_names: dict[uuid.UUID, str],
    report: ScreeningReport | None = None,
) -> ScreeningSessionResponse:
    return ScreeningSessionResponse(
        id=s.id,
        candidate_id=s.candidate_id,
        vacancy_id=s.vacancy_id,
        match_id=s.match_id,
        recruiter_id=s.recruiter_id,
        status=s.status,
        telemost_url=s.telemost_url,
        consent_confirmed=s.consent_confirmed,
        started_at=s.started_at,
        ended_at=s.ended_at,
        duration_sec=s.duration_sec,
        audio_file_id=s.audio_file_id,
        created_at=s.created_at,
        updated_at=s.updated_at,
        questions=[_question_dto(q) for q in s.questions],
        candidate_name=cand_names.get(s.candidate_id),
        vacancy_title=vac_titles.get(s.vacancy_id) if s.vacancy_id else None,
        recruiter_name=rec_names.get(s.recruiter_id) if s.recruiter_id else None,
        report=ScreeningReportDTO.model_validate(report) if report else None,
    )


async def to_dto(db: AsyncSession, s: ScreeningSession) -> ScreeningSessionResponse:
    cand_names, vac_titles, rec_names = await _names_for(db, [s])
    report = (
        await db.execute(
            select(ScreeningReport).where(ScreeningReport.session_id == s.id)
        )
    ).scalar_one_or_none()
    return _to_dto(
        s,
        cand_names=cand_names,
        vac_titles=vac_titles,
        rec_names=rec_names,
        report=report,
    )


# --- queries ---------------------------------------------------------------


async def list_sessions(
    db: AsyncSession,
    user: User,
    *,
    candidate_id: uuid.UUID | None = None,
    vacancy_id: uuid.UUID | None = None,
    recruiter_id: uuid.UUID | None = None,
    status_filter: ScreeningStatus | None = None,
    page: int = 1,
    page_size: int = 20,
) -> ScreeningListResponse:
    stmt = select(ScreeningSession).options(
        selectinload(ScreeningSession.questions)
    )
    if candidate_id is not None:
        stmt = stmt.where(ScreeningSession.candidate_id == candidate_id)
    if vacancy_id is not None:
        stmt = stmt.where(ScreeningSession.vacancy_id == vacancy_id)
    if recruiter_id is not None:
        stmt = stmt.where(ScreeningSession.recruiter_id == recruiter_id)
    if status_filter is not None:
        stmt = stmt.where(ScreeningSession.status == status_filter)

    if user.role not in _SEE_ALL_ROLES:
        assigned = select(VacancyRecruiter.vacancy_id).where(
            VacancyRecruiter.user_id == user.id
        )
        stmt = stmt.where(
            or_(
                ScreeningSession.recruiter_id == user.id,
                ScreeningSession.vacancy_id.in_(assigned),
            )
        )

    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    stmt = (
        stmt.order_by(ScreeningSession.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    sessions = list((await db.execute(stmt)).scalars().all())
    cand_names, vac_titles, rec_names = await _names_for(db, sessions)
    return ScreeningListResponse(
        items=[
            _to_dto(
                s, cand_names=cand_names, vac_titles=vac_titles, rec_names=rec_names
            )
            for s in sessions
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


# --- mutations -------------------------------------------------------------


async def create(
    db: AsyncSession, user: User, payload: CreateScreeningRequest
) -> ScreeningSessionResponse:
    if user.role not in _CREATOR_ROLES:
        raise Forbidden("Создавать скрининг могут админ, AM и рекрутер")

    cand = await db.get(Candidate, payload.candidate_id)
    if cand is None:
        raise NotFound("Кандидат не найден")
    if payload.vacancy_id is not None:
        vac = await db.get(Vacancy, payload.vacancy_id)
        if vac is None:
            raise NotFound("Вакансия не найдена")
    if payload.match_id is not None:
        match = await db.get(VacancyCandidate, payload.match_id)
        if match is None:
            raise NotFound("Связка кандидат-вакансия не найдена")

    session = ScreeningSession(
        candidate_id=payload.candidate_id,
        vacancy_id=payload.vacancy_id,
        match_id=payload.match_id,
        recruiter_id=user.id,
        telemost_url=payload.telemost_url,
        status=ScreeningStatus.draft,
    )
    manual = [q.strip() for q in payload.questions if q.strip()]
    for i, text in enumerate(manual):
        session.questions.append(
            ScreeningQuestion(
                position=i,
                text_=text,
                source=ScreeningQuestionSource.manual,
            )
        )
    db.add(session)
    await db.commit()
    session = await _load(db, session.id)

    # Этап 3: если рекрутер не вбил вопросы руками — пробуем AI.
    # Ошибки AI глотаем: сессия уже создана, перегенерация — отдельной кнопкой.
    if not manual and payload.generate_questions:
        try:
            return await regenerate_questions(
                db, user, session.id, RegenerateQuestionsRequest()
            )
        except ApiError as exc:
            # 503/502 от regenerate — сессия уже есть, рекрутер догенерит кнопкой.
            if exc.status_code in (
                status.HTTP_503_SERVICE_UNAVAILABLE,
                status.HTTP_502_BAD_GATEWAY,
            ):
                logger.warning(
                    "screening.create: AI questions skipped for %s: %s",
                    session.id,
                    exc.detail,
                )
            else:
                raise

    return await to_dto(db, session)


async def get(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    await _ensure_can_see(db, user, session)
    return await to_dto(db, session)


async def update(
    db: AsyncSession, user: User, session_id: uuid.UUID, payload: UpdateScreeningRequest
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if payload.telemost_url is not None:
        session.telemost_url = payload.telemost_url
    if payload.consent_confirmed is not None:
        session.consent_confirmed = payload.consent_confirmed
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session)


async def start(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if session.status not in (ScreeningStatus.draft, ScreeningStatus.live):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "invalid_status",
            "Стартовать можно только сессию в статусе draft",
        )
    if not session.consent_confirmed:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "consent_required",
            "Перед записью подтвердите согласие кандидата на запись разговора",
        )
    if session.status == ScreeningStatus.draft:
        session.status = ScreeningStatus.live
        session.started_at = datetime.now(UTC)
        await db.commit()
        session = await _load(db, session_id)
    return await to_dto(db, session)


async def finish(
    db: AsyncSession,
    user: User,
    session_id: uuid.UUID,
    payload: FinishScreeningRequest,
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if session.status not in (ScreeningStatus.live, ScreeningStatus.done):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "invalid_status",
            "Завершить можно только идущую сессию",
        )
    if session.status == ScreeningStatus.live:
        session.status = ScreeningStatus.done  # Этап 5: processing + Celery
        session.ended_at = datetime.now(UTC)
        if payload.duration_sec is not None:
            session.duration_sec = payload.duration_sec
        elif session.started_at is not None:
            session.duration_sec = int(
                (session.ended_at - session.started_at).total_seconds()
            )
        await db.commit()
        session = await _load(db, session_id)
    return await to_dto(db, session)


async def attach_audio(
    db: AsyncSession, user: User, session_id: uuid.UUID, file_id: uuid.UUID
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    file = await db.get(File, file_id)
    if file is None:
        raise NotFound("Файл не найден")
    if file.entity_type != FileEntityType.screening or file.entity_id != session.id:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "file_entity_mismatch",
            "Файл не принадлежит этой сессии скрининга",
        )
    session.audio_file_id = file_id
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session)


async def delete(db: AsyncSession, user: User, session_id: uuid.UUID) -> None:
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    await db.delete(session)
    await db.commit()


# --- questions -------------------------------------------------------------


async def add_question(
    db: AsyncSession, user: User, session_id: uuid.UUID, payload: AddQuestionRequest
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if not payload.text.strip():
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "empty_question",
            "Текст вопроса не может быть пустым",
        )
    position = (
        payload.position
        if payload.position is not None
        else (max((q.position for q in session.questions), default=-1) + 1)
    )
    session.questions.append(
        ScreeningQuestion(
            position=position,
            text_=payload.text.strip(),
            goal=payload.goal,
            source=ScreeningQuestionSource.manual,
        )
    )
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session)


async def update_question(
    db: AsyncSession,
    user: User,
    session_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: UpdateQuestionRequest,
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    question = next((q for q in session.questions if q.id == question_id), None)
    if question is None:
        raise NotFound("Вопрос не найден")
    if payload.text is not None:
        question.text_ = payload.text
    if payload.goal is not None:
        question.goal = payload.goal
    if payload.status is not None:
        question.status = payload.status
    if payload.position is not None:
        question.position = payload.position
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session)


async def delete_question(
    db: AsyncSession, user: User, session_id: uuid.UUID, question_id: uuid.UUID
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    question = next((q for q in session.questions if q.id == question_id), None)
    if question is None:
        raise NotFound("Вопрос не найден")
    session.questions.remove(question)
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session)


# --- AI questions (Этап 3) -------------------------------------------------


async def regenerate_questions(
    db: AsyncSession,
    user: User,
    session_id: uuid.UUID,
    payload: RegenerateQuestionsRequest | None = None,
) -> ScreeningSessionResponse:
    """Перегенерировать план вопросов (только draft).

    По умолчанию сохраняет `source=manual`, заменяет AI/follow-up.
    `replace_manual=true` — полный сброс чек-листа.
    """
    payload = payload or RegenerateQuestionsRequest()
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if session.status != ScreeningStatus.draft:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "invalid_status",
            "Перегенерировать вопросы можно только до начала встречи",
        )

    cand = await db.get(Candidate, session.candidate_id)
    if cand is None:
        raise NotFound("Кандидат не найден")
    vac = (
        await db.get(Vacancy, session.vacancy_id)
        if session.vacancy_id is not None
        else None
    )

    try:
        generated = await screening_ai.generate_screening_questions(
            candidate_payload=candidate_payload(cand),
            vacancy_payload=vacancy_payload(vac) if vac is not None else None,
            count=payload.count if payload.count is not None else 8,
        )
    except screening_ai.AiUnavailableError as exc:
        logger.warning("screening.regenerate unavailable: %s", exc)
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ai_unavailable",
            "Сервис AI временно недоступен. Добавьте вопросы вручную или попробуйте позже.",
        ) from exc
    except screening_ai.AiBadRequestError as exc:
        logger.error("screening.regenerate bad request: %s", exc)
        raise ApiError(
            status.HTTP_502_BAD_GATEWAY,
            "ai_bad_request",
            "Не удалось сгенерировать вопросы. Попробуйте ещё раз.",
        ) from exc

    keep: list[ScreeningQuestion] = []
    if not payload.replace_manual:
        keep = [
            q
            for q in session.questions
            if q.source == ScreeningQuestionSource.manual
        ]
    # SQLAlchemy orphan-delete: очищаем коллекцию и наполняем заново.
    session.questions.clear()
    await db.flush()

    position = 0
    for q in sorted(keep, key=lambda x: x.position):
        session.questions.append(
            ScreeningQuestion(
                position=position,
                text_=q.text_,
                goal=q.goal,
                source=ScreeningQuestionSource.manual,
                status=q.status,
            )
        )
        position += 1
    for item in generated:
        session.questions.append(
            ScreeningQuestion(
                position=position,
                text_=item["text"],
                goal=item.get("goal"),
                source=ScreeningQuestionSource.pregenerated,
            )
        )
        position += 1

    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session)


# --- transcript (Этап 2) ---------------------------------------------------


def _segment_dto(seg: ScreeningSegment) -> ScreeningSegmentDTO:
    return ScreeningSegmentDTO(
        id=seg.id,
        seq=seg.seq,
        speaker=seg.speaker,
        text=seg.text_,
        started_ms=seg.started_ms,
        ended_ms=seg.ended_ms,
    )


async def next_seq(db: AsyncSession, session_id: uuid.UUID) -> int:
    """Следующий свободный seq (max+1). 1, если сегментов ещё нет."""
    current = (
        await db.execute(
            select(func.coalesce(func.max(ScreeningSegment.seq), 0)).where(
                ScreeningSegment.session_id == session_id
            )
        )
    ).scalar_one()
    return int(current) + 1


async def append_segment(
    db: AsyncSession,
    session_id: uuid.UUID,
    *,
    speaker: ScreeningSpeaker,
    text: str,
    started_ms: int,
    ended_ms: int,
) -> ScreeningSegment:
    """Записать финальный сегмент. UNIQUE(session_id, seq) защищает от дублей."""
    last_error: Exception | None = None
    for _ in range(5):
        seq = await next_seq(db, session_id)
        seg = ScreeningSegment(
            session_id=session_id,
            seq=seq,
            speaker=speaker,
            text_=text,
            started_ms=started_ms,
            ended_ms=ended_ms,
        )
        db.add(seg)
        try:
            await db.commit()
            await db.refresh(seg)
            return seg
        except IntegrityError as exc:
            await db.rollback()
            last_error = exc
            continue
    raise ApiError(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "segment_persist_failed",
        "Не удалось сохранить сегмент транскрипта",
    ) from last_error


async def list_transcript(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> TranscriptResponse:
    session = await _load(db, session_id)
    await _ensure_can_see(db, user, session)
    rows = list(
        (
            await db.execute(
                select(ScreeningSegment)
                .where(ScreeningSegment.session_id == session_id)
                .order_by(ScreeningSegment.seq.asc())
            )
        )
        .scalars()
        .all()
    )
    last = rows[-1].seq if rows else 0
    return TranscriptResponse(
        items=[_segment_dto(s) for s in rows],
        last_seq=last,
    )
