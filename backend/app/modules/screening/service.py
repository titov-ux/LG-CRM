"""Сервис AI-скрининга: сессии, чек-лист вопросов, привязка записи.

Бизнес-правила Этапа 1:
* ведущим (`recruiter_id`) становится автор;
* видимость: admin и account_manager видят все сессии; остальные — только
  свои (где они ведущие) и сессии по вакансиям, где они назначены;
* переход draft → live требует `consent_confirmed=true` (409 consent_required):
  запись разговора без согласия кандидата не начинаем (152-ФЗ);
* finish: live → processing + постановка пост-анализа (Этап 5) → done/error;
* удалять сессию может ведущий или admin.

Этап 3: генерация / перегенерация плана вопросов через YandexGPT
(`screening/ai.py`) по резюме кандидата и полям вакансии.
Этап 4: live-обновления чек-листа — в `screening/agent.py` + WS.
Этап 5: пост-анализ → `screening_reports` + activity/notify.
Этап 6: права `screening:run` / `screening:view_report` (permissions-matrix),
метрики (`screening/metrics.py`), hard-stop по длительности, retention аудио.
"""
from __future__ import annotations

import asyncio
import difflib
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from fastapi import status
from sqlalchemy import func, or_, select
# `delete` в этом модуле — сервисная функция удаления сессии, поэтому
# SQL-конструктор берём под алиасом (как и `update`).
from sqlalchemy import delete as sa_delete
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.errors import ApiError, Forbidden, NotFound
from app.modules.permissions import service as permissions_service
from app.modules.screening import metrics as screening_metrics
from app.db.session import SessionLocal
from app.modules.audit import service as audit_service
from app.modules.audit.models import ActivityEntityType, ActivityKind
from app.modules.candidates.models import Candidate
from app.modules.files.models import File, FileEntityType
from app.modules.matching.models import VacancyCandidate
from app.modules.matching.service import candidate_payload, vacancy_payload
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind
from app.modules.screening import ai as screening_ai
from app.modules.screening import report as screening_report
from app.modules.screening.models import (
    ScreeningQuestion,
    ScreeningQuestionSource,
    ScreeningQuestionStatus,
    ScreeningReport,
    ScreeningSegment,
    ScreeningSession,
    ScreeningSpeaker,
    ScreeningStatus,
    ScreeningVerdict,
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
from app.modules.screening.tasks import (
    enqueue_screening_analysis,
    enqueue_screening_offline_transcribe,
    wait_for_pending_analysis,
)
from app.modules.users.models import Role, User
from app.modules.vacancies.models import Vacancy, VacancyRecruiter
from app.realtime.events import publish_screening_report_ready

if TYPE_CHECKING:
    from app.integrations.s3 import S3Adapter

logger = logging.getLogger(__name__)

ACTION_RUN = "screening:run"
ACTION_VIEW_REPORT = "screening:view_report"
_SEE_ALL_ROLES = (Role.admin, Role.account_manager)

_VERDICT_LABELS = {
    ScreeningVerdict.fit: "подходит",
    ScreeningVerdict.partial_fit: "частично подходит",
    ScreeningVerdict.no_fit: "не подходит",
}


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


async def _require_run(db: AsyncSession, user: User) -> None:
    await permissions_service.require_action(
        db,
        user,
        ACTION_RUN,
        message="Недостаточно прав на проведение скрининга",
    )


async def _can_run_session(db: AsyncSession, user: User, s: ScreeningSession) -> bool:
    """Может ли пользователь вести эту сессию (а не просто видеть её).

    Тот же критерий, что у `_ensure_can_edit` + `_require_run`, но без
    исключения: нужен для «побочных» действий на чтении (авто-офлайн-STT).
    """
    if not (user.role == Role.admin or s.recruiter_id == user.id):
        return False
    return await permissions_service.user_has_action(db, user, ACTION_RUN)


async def _require_view_report(db: AsyncSession, user: User) -> None:
    await permissions_service.require_action(
        db,
        user,
        ACTION_VIEW_REPORT,
        message="Недостаточно прав на просмотр отчёта скрининга",
    )


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
        # Сортируем явно: relationship отдаёт коллекцию в том порядке, в
        # котором её загрузили, и после смены position в этой же сессии
        # (expire_on_commit=False) повторный _load её не переупорядочит —
        # клиент получал вопросы в старом порядке с новыми номерами.
        # Вторичный ключ по id — детерминированность при дублях position,
        # которые может оставить агент.
        questions=[
            _question_dto(q)
            for q in sorted(s.questions, key=lambda q: (q.position, str(q.id)))
        ],
        candidate_name=cand_names.get(s.candidate_id),
        vacancy_title=vac_titles.get(s.vacancy_id) if s.vacancy_id else None,
        recruiter_name=rec_names.get(s.recruiter_id) if s.recruiter_id else None,
        report=ScreeningReportDTO.model_validate(report) if report else None,
    )


def _mask_without_view_report(
    dto: ScreeningSessionResponse,
    user: User,
    recruiter_id: uuid.UUID | None,
) -> ScreeningSessionResponse:
    """Убрать из DTO содержимое встречи для роли без `view_report`.

    `answer_summary` — тот же материал встречи, что транскрипт и отчёт (его
    пишет агент по словам кандидата), поэтому режем и его. Исключение —
    ведущий рекрутер и админ: они ведут встречу и читают её без права
    `view_report` (тот же компромисс, что в `list_segments`), иначе во время
    интервью у роли без права пропадали бы собственные пометки.
    """
    update: dict = {"report": None, "audio_file_id": None}
    if not (user.role == Role.admin or recruiter_id == user.id):
        update["questions"] = [
            q.model_copy(update={"answer_summary": None}) for q in dto.questions
        ]
    return dto.model_copy(update=update)


async def to_dto(
    db: AsyncSession,
    s: ScreeningSession,
    *,
    user: User | None = None,
) -> ScreeningSessionResponse:
    cand_names, vac_titles, rec_names = await _names_for(db, [s])
    report = (
        await db.execute(
            select(ScreeningReport).where(ScreeningReport.session_id == s.id)
        )
    ).scalar_one_or_none()
    dto = _to_dto(
        s,
        cand_names=cand_names,
        vac_titles=vac_titles,
        rec_names=rec_names,
        report=report,
    )
    if user is not None and not await permissions_service.user_has_action(
        db, user, ACTION_VIEW_REPORT
    ):
        dto = _mask_without_view_report(dto, user, s.recruiter_id)
    return dto


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
    can_view = await permissions_service.user_has_action(
        db, user, ACTION_VIEW_REPORT
    )
    reports: dict[uuid.UUID, ScreeningReport] = {}
    if sessions:
        rows = (
            (
                await db.execute(
                    select(ScreeningReport).where(
                        ScreeningReport.session_id.in_([s.id for s in sessions])
                    )
                )
            )
            .scalars()
            .all()
        )
        reports = {r.session_id: r for r in rows}
    items = []
    for s in sessions:
        dto = _to_dto(
            s,
            cand_names=cand_names,
            vac_titles=vac_titles,
            rec_names=rec_names,
            report=reports.get(s.id),
        )
        if not can_view:
            dto = _mask_without_view_report(dto, user, s.recruiter_id)
        items.append(dto)
    return ScreeningListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# --- mutations -------------------------------------------------------------


async def create(
    db: AsyncSession, user: User, payload: CreateScreeningRequest
) -> ScreeningSessionResponse:
    await _require_run(db, user)

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

    return await to_dto(db, session, user=user)


async def get(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> ScreeningSessionResponse:
    session = await _load(db, session_id)
    await _ensure_can_see(db, user, session)
    # Запись есть, транскрипта нет (live-STT не сработал) — поднять офлайн-STT
    # сами, без кнопки. Не ждём: UI поллит status=processing.
    # Только для того, кто реально может вести сессию: иначе обычный GET у
    # смежного рекрутера/наблюдателя менял статус и жёг деньги на STT+LLM.
    may_run = await _can_run_session(db, user, session)
    if may_run and await maybe_start_offline_transcription(db, session):
        await db.commit()
        db.expire(session)
        session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


async def update(
    db: AsyncSession, user: User, session_id: uuid.UUID, payload: UpdateScreeningRequest
) -> ScreeningSessionResponse:
    await _require_run(db, user)
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if payload.telemost_url is not None:
        session.telemost_url = payload.telemost_url
    if payload.consent_confirmed is not None:
        if (
            payload.consent_confirmed is False
            and session.status != ScreeningStatus.draft
        ):
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "invalid_status",
                "Снять согласие можно только до начала встречи",
            )
        session.consent_confirmed = payload.consent_confirmed
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


async def start(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> ScreeningSessionResponse:
    await _require_run(db, user)
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if session.status not in (ScreeningStatus.draft, ScreeningStatus.live):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "invalid_status",
            "Стартовать можно только сессию в статусе draft или live",
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
    return await to_dto(db, session, user=user)


async def finish(
    db: AsyncSession,
    user: User,
    session_id: uuid.UUID,
    payload: FinishScreeningRequest,
) -> ScreeningSessionResponse:
    await _require_run(db, user)
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if session.status not in (
        ScreeningStatus.live,
        ScreeningStatus.processing,
        ScreeningStatus.done,
    ):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "invalid_status",
            "Завершить можно только идущую сессию",
        )
    if session.status == ScreeningStatus.live:
        # Read-modify-write без блокировки: два параллельных (или просто
        # повторных) POST /finish оба видели live и оба ставили пост-анализ.
        # Берём строку под FOR UPDATE и перечитываем статус уже под ней —
        # переводит сессию ровно один запрос.
        locked_status = (
            await db.execute(
                select(ScreeningSession.status)
                .where(ScreeningSession.id == session_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if locked_status is None:
            raise NotFound("Сессия скрининга не найдена")
        if locked_status != ScreeningStatus.live:
            # Гонку выиграл соседний запрос. Освобождаем блокировку и отдаём
            # актуальное состояние — тот же контракт, что у повторного finish
            # по processing/done (200) и по остальным статусам (409).
            # Именно commit, а не rollback: транзакция чистая (мы только
            # читали), а rollback сделал бы expire_all() — включая объект
            # текущего пользователя, и следующий `user.role` в to_dto упал бы
            # ленивой подгрузкой в async-контексте (MissingGreenlet → 500).
            await db.commit()
            session = await _load(db, session_id)
            if session.status not in (
                ScreeningStatus.processing,
                ScreeningStatus.done,
            ):
                raise ApiError(
                    status.HTTP_409_CONFLICT,
                    "invalid_status",
                    "Завершить можно только идущую сессию",
                )
            return await to_dto(db, session, user=user)
        session.status = ScreeningStatus.processing
        session.ended_at = datetime.now(UTC)
        if payload.duration_sec is not None:
            session.duration_sec = payload.duration_sec
        elif session.started_at is not None:
            session.duration_sec = int(
                (session.ended_at - session.started_at).total_seconds()
            )
        await _enqueue_post_meeting(db, session)
        await db.commit()
        # eager (dev/tests): дожидаемся анализа (и офлайн-STT, если нужен).
        # В проде задача уходит в Celery и ответ всегда processing.
        await wait_for_pending_analysis(timeout=180.0)
        # SessionLocal живёт с expire_on_commit=False: без явного сброса
        # мы бы вернули свой устаревший объект (processing), хотя фоновая
        # задача уже перевела сессию в done. Точечно, не expire_all():
        # тот бы обнулил и текущего пользователя → ленивая подгрузка в
        # async-контексте и MissingGreenlet.
        db.expire(session)
        session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


async def _segment_count(db: AsyncSession, session_id: uuid.UUID) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(ScreeningSegment)
                .where(ScreeningSegment.session_id == session_id)
            )
        ).scalar_one()
    )


async def _enqueue_post_meeting(db: AsyncSession, session: ScreeningSession) -> None:
    """После finish: офлайн-STT если нет live-сегментов, иначе сразу отчёт."""
    n = await _segment_count(db, session.id)
    if n == 0 and session.audio_file_id is not None:
        enqueue_screening_offline_transcribe(db.sync_session, session.id)
    else:
        enqueue_screening_analysis(db.sync_session, session.id)


# Не крутить офлайн-STT на каждом GET после неудачной попытки (отчёт уже есть).
_OFFLINE_RETRY_COOLDOWN = timedelta(minutes=15)


async def maybe_start_offline_transcription(
    db: AsyncSession,
    session: ScreeningSession,
    *,
    force: bool = False,
) -> bool:
    """Если есть запись и нет транскрипта — поставить офлайн-STT в очередь.

    Возвращает True, если задача поставлена (нужен commit вызывающим).
    `force=True` — явное действие (attach / кнопка «Распознать запись»).

    Важно: GET поллит сессию раз в ~5с пока status=processing. Авто-повтор
    при уже готовом LLM-отчёте превращался в шторм уведомлений. Поэтому без
    `force` не трогаем сессию с «живым» отчётом.

    Исключение: `model=fallback` при пустом транскрипте (запись есть, сегментов
    нет) — типичный зависший кейс после сбоя офлайн-STT. Такой отчёт не
    блокирует авто-повтор, но только после cooldown (иначе poll раз в 5с
    снова заливает очередь).

    `force=True` при processing тоже ставит задачу снова: иначе attach во
    время processing сохранял файл, но офлайн-STT не запускался, а кнопка
    «Распознать» была скрыта — сессия зависала навсегда.
    """
    if session.audio_file_id is None:
        return False
    if session.status in (ScreeningStatus.draft, ScreeningStatus.live):
        return False
    if await _segment_count(db, session.id) > 0:
        return False

    report = (
        await db.execute(
            select(ScreeningReport).where(ScreeningReport.session_id == session.id)
        )
    ).scalar_one_or_none()

    # LLM-отчёт уже есть → авто не перезапускаем. Fallback при пустом
    # транскрипте — ещё шанс вытянуть текст из записи (с cooldown ниже).
    if report is not None and not force:
        if (report.model or "") != "fallback":
            logger.info(
                "screening.offline: skip auto for %s — report already exists",
                session.id,
            )
            return False

    if session.status == ScreeningStatus.processing:
        if not force:
            anchor = session.updated_at or session.ended_at or session.created_at
            if anchor is None:
                return False
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=UTC)
            if datetime.now(UTC) - anchor < _OFFLINE_RETRY_COOLDOWN:
                return False
        # Зависли без сегментов / явный force (attach или «Распознать запись»).
        # Раньше force=True при processing возвращал False — и attach во время
        # processing молча сохранял файл, но офлайн-STT не ставил в очередь.
        # bump updated_at, иначе каждый следующий GET снова пройдёт cooldown.
        session.updated_at = datetime.now(UTC)
        enqueue_screening_offline_transcribe(db.sync_session, session.id)
        logger.info(
            "screening.offline: re-queued processing %s (force=%s)",
            session.id,
            force,
        )
        return True

    if session.status not in (ScreeningStatus.done, ScreeningStatus.error):
        return False

    # done/error + fallback + нет сегментов: не крутить на каждом открытии
    # карточки — только после cooldown (force с кнопки — сразу).
    # Без отчёта cooldown не нужен: это первый запуск офлайн-STT.
    if (
        not force
        and report is not None
        and (report.model or "") == "fallback"
    ):
        anchor = (
            session.updated_at
            or report.created_at
            or session.ended_at
            or session.created_at
        )
        if anchor is None:
            return False
        if anchor.tzinfo is None:
            anchor = anchor.replace(tzinfo=UTC)
        if datetime.now(UTC) - anchor < _OFFLINE_RETRY_COOLDOWN:
            logger.info(
                "screening.offline: skip auto for %s — fallback cooldown",
                session.id,
            )
            return False

    session.status = ScreeningStatus.processing
    session.updated_at = datetime.now(UTC)
    enqueue_screening_offline_transcribe(db.sync_session, session.id)
    logger.info(
        "screening.offline: queued for %s (force=%s)", session.id, force
    )
    return True


async def attach_audio(
    db: AsyncSession, user: User, session_id: uuid.UUID, file_id: uuid.UUID
) -> ScreeningSessionResponse:
    await _require_run(db, user)
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
    mime = (getattr(file, "mime", None) or getattr(file, "mime_type", "") or "").lower()
    if mime and not mime.startswith("audio/"):
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "file_not_audio",
            "К сессии скрининга можно привязать только аудиозапись",
        )
    session.audio_file_id = file_id
    # Пост-фактум / повтор: запись есть, live-транскрипта нет → офлайн-STT.
    queue_offline = await maybe_start_offline_transcription(db, session, force=True)
    await db.commit()
    if queue_offline:
        # Eager (dev): дождаться текста+отчёта. В prod задача уходит в Celery,
        # ответ сразу processing — UI поллит.
        await wait_for_pending_analysis(timeout=180.0)
        db.expire(session)
        session = await _load(db, session_id)
    else:
        session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


async def retranscribe(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> ScreeningSessionResponse:
    """Прогнать распознавание прикреплённой записи заново.

    Отличие от `attach_audio` / авто-повтора: работает и когда транскрипт уже
    есть — старый текст заменяется свежим, а отчёт пересобирается по нему
    (`run_post_analysis(replace_report=True)` внутри офлайн-задачи). Нужно,
    когда первый прогон дал мусор: обрезанную запись, чужую дорожку, текст до
    починки STT. Пустой ответ STT ничего не стирает (см.
    `insert_offline_segments`).
    """
    await _require_run(db, user)
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if session.audio_file_id is None:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "no_audio",
            "К сессии не привязана запись разговора",
        )
    if session.status in (ScreeningStatus.draft, ScreeningStatus.live):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "session_not_finished",
            "Распознать заново можно только после завершения встречи",
        )
    session.status = ScreeningStatus.processing
    # bump: по updated_at считается cooldown авто-повторов офлайн-STT.
    session.updated_at = datetime.now(UTC)
    enqueue_screening_offline_transcribe(db.sync_session, session.id, replace=True)
    await db.commit()
    logger.info("screening.offline: manual re-run queued for %s", session_id)
    # Eager (dev/tests): дождаться текста и отчёта. В prod задача уходит в
    # Celery, ответ сразу processing — UI поллит карточку.
    await wait_for_pending_analysis(timeout=180.0)
    db.expire(session)
    session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


async def _delete_audio_file(db: AsyncSession, file_id: uuid.UUID) -> bool:
    """Удалить объект записи в S3 и строку files. Ошибка S3 не валит вызов."""
    from app.integrations.s3 import get_s3_adapter

    file = await db.get(File, file_id)
    if file is None:
        return False
    if file.entity_type != FileEntityType.screening:
        return False
    try:
        s3 = get_s3_adapter()
        await asyncio.to_thread(s3.delete, file_key=file.file_key)
    except Exception:
        logger.exception("screening: S3 delete failed for %s", file.file_key)
        return False
    await db.delete(file)
    await db.commit()
    return True


async def delete(db: AsyncSession, user: User, session_id: uuid.UUID) -> None:
    await _require_run(db, user)
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    audio_file_id = session.audio_file_id
    # FK audio_file_id стоит SET NULL, поэтому файл пережил бы сессию и никогда
    # не попал бы под retention — чистим руками и ДО удаления сессии: если S3
    # ответит ошибкой уже после db.delete(session), запись останется в бакете
    # сиротой, невидимой ни ретеншену, ни этому коду (152-ФЗ). Осиротевшие
    # всё же подметает вторая фаза `purge_expired_audio`.
    if audio_file_id is not None:
        await _delete_audio_file(db, audio_file_id)
        session = await _load(db, session_id)
    await db.delete(session)
    await db.commit()


# --- questions -------------------------------------------------------------


def _renumber_questions(session: ScreeningSession) -> None:
    """Пронумеровать вопросы 0..N-1 по текущему порядку.

    Чек-лист сортируется по `position`, а он приходил и от клиента, и от
    агента: дубли и дыры давали недетерминированный порядок (после каждого
    рефетча вопросы прыгали местами). Нормализуем на каждой мутации списка.
    """
    for index, q in enumerate(sorted(session.questions, key=lambda x: x.position)):
        if q.position != index:
            q.position = index


def _place_question(
    session: ScreeningSession, question: ScreeningQuestion, position: int
) -> None:
    """Поставить вопрос на `position`, сдвинув остальных, и перенумеровать.

    Считаем по итоговому порядку списка, а не «сдвинуть всех, у кого
    position >= target»: последнее промахивалось на единицу при переносе вниз
    (сосед, который и так был ниже исходной позиции, сдвигался ещё раз).
    """
    ordered = [q for q in session.questions if q is not question]
    ordered.sort(key=lambda q: q.position)
    index = max(0, min(position, len(ordered)))
    ordered.insert(index, question)
    for i, q in enumerate(ordered):
        q.position = i


async def add_question(
    db: AsyncSession, user: User, session_id: uuid.UUID, payload: AddQuestionRequest
) -> ScreeningSessionResponse:
    await _require_run(db, user)
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    if not payload.text.strip():
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "empty_question",
            "Текст вопроса не может быть пустым",
        )
    question = ScreeningQuestion(
        position=max((q.position for q in session.questions), default=-1) + 1,
        text_=payload.text.strip(),
        goal=payload.goal,
        source=ScreeningQuestionSource.manual,
    )
    session.questions.append(question)
    if payload.position is not None:
        # Освобождаем место под вставку: иначе два вопроса с одинаковым
        # position, и порядок чек-листа становится случайным.
        _place_question(session, question, payload.position)
    else:
        _renumber_questions(session)
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


async def update_question(
    db: AsyncSession,
    user: User,
    session_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: UpdateQuestionRequest,
) -> ScreeningSessionResponse:
    await _require_run(db, user)
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
        # Как и при вставке: двигаем соседей, потом нормализуем нумерацию.
        _place_question(session, question, payload.position)
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


async def delete_question(
    db: AsyncSession, user: User, session_id: uuid.UUID, question_id: uuid.UUID
) -> ScreeningSessionResponse:
    await _require_run(db, user)
    session = await _load(db, session_id)
    _ensure_can_edit(user, session)
    question = next((q for q in session.questions if q.id == question_id), None)
    if question is None:
        raise NotFound("Вопрос не найден")
    session.questions.remove(question)
    # После удаления в нумерации остаётся дыра — схлопываем.
    _renumber_questions(session)
    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


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
    await _require_run(db, user)
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
    # Ручные вопросы НЕ пересоздаём: на их id ссылаются фронт и агент, плюс в
    # них может быть answer_summary. Удаляем только AI-вопросы (orphan-delete).
    keep_ids = {q.id for q in keep}
    for q in list(session.questions):
        if q.id not in keep_ids:
            session.questions.remove(q)
    await db.flush()

    position = 0
    for q in sorted(keep, key=lambda x: x.position):
        q.position = position
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
    # Ручные вопросы могли прийти с дублями position ещё из старых сессий.
    _renumber_questions(session)

    await db.commit()
    session = await _load(db, session_id)
    return await to_dto(db, session, user=user)


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


_HALLUCINATION_PATTERNS = (
    re.compile(r"^\s*(субтитры|редактор субтитров|корректор)\b", re.I),
    re.compile(r"(dimatorzok|димасторжок|субтитры сделал)", re.I),
    re.compile(r"^\s*продолжение следует\s*[.!…]*\s*$", re.I),
    re.compile(r"^\s*(спасибо за просмотр|подписывайтесь на канал)", re.I),
    re.compile(r"^[\s.,!?…\-–—*]+$"),
)
# Допуск при сравнении интервалов и порог похожести текста для дедупа эха.
_DEDUP_WINDOW_MS = 2000
_DEDUP_RATIO = 0.85
_DEDUP_LOOKBACK = 6


def _normalize_text(text: str) -> str:
    return re.sub(r"[^\w\s]", " ", (text or "").casefold()).strip()


def is_hallucination(text: str) -> bool:
    """Типовые галлюцинации Whisper на тишине/музыке (риск из плана)."""
    t = (text or "").strip()
    if not t:
        return True
    if len(_normalize_text(t)) < 2:
        return True
    return any(p.search(t) for p in _HALLUCINATION_PATTERNS)


def is_duplicate_segment(
    text: str,
    started_ms: int,
    ended_ms: int,
    recent: list[ScreeningSegment],
) -> bool:
    """Эхо: та же реплика пришла по второму каналу (рекрутер без наушников)
    либо дубль после reconnect. Сравниваем по пересечению времени + похожести."""
    norm = _normalize_text(text)
    if not norm:
        return True
    for seg in recent:
        if seg.started_ms - _DEDUP_WINDOW_MS > ended_ms:
            continue
        if seg.ended_ms + _DEDUP_WINDOW_MS < started_ms:
            continue
        other = _normalize_text(seg.text_ or "")
        if not other:
            continue
        if other == norm:
            return True
        if difflib.SequenceMatcher(None, norm, other).ratio() >= _DEDUP_RATIO:
            return True
    return False


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
) -> ScreeningSegment | None:
    """Записать финальный сегмент транскрипта.

    Возвращает None, если сегмент отброшен: сессия уже не live, текст похож на
    галлюцинацию Whisper либо это эхо/дубль соседнего канала.
    UNIQUE(session_id, seq) защищает от гонки двух писателей.
    """
    current_status = (
        await db.execute(
            select(ScreeningSession.status).where(ScreeningSession.id == session_id)
        )
    ).scalar_one_or_none()
    if current_status != ScreeningStatus.live:
        logger.info(
            "screening.segment: skip for %s (status=%s)", session_id, current_status
        )
        return None
    if is_hallucination(text):
        screening_metrics.record_segment_dropped("hallucination")
        return None
    recent = list(
        (
            await db.execute(
                select(ScreeningSegment)
                .where(ScreeningSegment.session_id == session_id)
                .order_by(ScreeningSegment.seq.desc())
                .limit(_DEDUP_LOOKBACK)
            )
        )
        .scalars()
        .all()
    )
    if is_duplicate_segment(text, started_ms, ended_ms, recent):
        screening_metrics.record_segment_dropped("duplicate")
        return None

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


async def _fetch_segments(
    db: AsyncSession, session_id: uuid.UUID
) -> list[ScreeningSegment]:
    return list(
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


async def list_transcript(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> TranscriptResponse:
    await _require_view_report(db, user)
    session = await _load(db, session_id)
    await _ensure_can_see(db, user, session)
    rows = await _fetch_segments(db, session_id)
    last = rows[-1].seq if rows else 0
    return TranscriptResponse(
        items=[_segment_dto(s) for s in rows],
        last_seq=last,
    )


async def list_segments(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> list[ScreeningSegmentDTO]:
    """Плоский список сегментов — контракт GET /screenings/{id}/segments.

    Ведущий рекрутер и админ читают транскрипт СВОЕЙ встречи без права
    `view_report`: иначе у роли без этого права ломается дозагрузка
    пропущенных сегментов после реконнекта WS прямо во время интервью.
    Посторонним (кто видит сессию по вакансии) право по-прежнему нужно.
    """
    session = await _load(db, session_id)
    await _ensure_can_see(db, user, session)
    if not (user.role == Role.admin or session.recruiter_id == user.id):
        await _require_view_report(db, user)
    return [_segment_dto(x) for x in await _fetch_segments(db, session_id)]


async def insert_offline_segments(
    db: AsyncSession,
    session_id: uuid.UUID,
    items: list[dict],
    *,
    speaker: ScreeningSpeaker = ScreeningSpeaker.candidate,
    replace: bool = False,
) -> int:
    """Записать сегменты офлайн-STT (сессия уже не live).

    Не трогает существующий live-транскрипт: если сегменты уже есть — no-op.
    `replace=True` («Распознать заново») — наоборот, старые сегменты сносятся
    и заменяются свежими; удаление делаем здесь, когда текст от STT уже на
    руках, чтобы неудачный прогон не оставил сессию без транскрипта вообще.
    Роль берётся из дорожки записи (стерео: микрофон = рекрутёр, вкладка =
    кандидат). У старых моно-записей дорожка одна — там всё уйдёт как
    `speaker` (по умолчанию кандидат), как и было до Этапа 7.
    """
    had_segments = await _segment_count(db, session_id) > 0
    if had_segments and not replace:
        return 0
    rows: list[ScreeningSegment] = []
    seq = 0
    # Сегменты двух дорожек приходят вперемешку — раскладываем по времени,
    # иначе seq (а значит и порядок в UI) не совпадёт с ходом разговора.
    ordered = sorted(
        items,
        key=lambda x: (
            int(x.get("startedMs") or x.get("started_ms") or 0),
            int(x.get("endedMs") or x.get("ended_ms") or 0),
        ),
    )
    for item in ordered:
        text = (item.get("text") or "").strip()
        if not text or is_hallucination(text):
            continue
        seq += 1
        started = int(item.get("startedMs") or item.get("started_ms") or 0)
        ended = int(item.get("endedMs") or item.get("ended_ms") or started)
        if ended < started:
            ended = started
        raw_speaker = str(item.get("speaker") or "").strip().lower()
        try:
            item_speaker = ScreeningSpeaker(raw_speaker) if raw_speaker else speaker
        except ValueError:
            item_speaker = speaker
        rows.append(
            ScreeningSegment(
                session_id=session_id,
                seq=seq,
                speaker=item_speaker,
                text_=text,
                started_ms=started,
                ended_ms=ended,
            )
        )
    if not rows:
        # Пустой прогон при replace: старый транскрипт не трогаем — иначе
        # «распознать заново» на сбойной записи стирало бы имеющийся текст.
        return 0
    if had_segments:
        await db.execute(
            sa_delete(ScreeningSegment).where(ScreeningSegment.session_id == session_id)
        )
        await db.flush()
    db.add_all(rows)
    await db.commit()
    return len(rows)


async def run_offline_transcription(
    session_id: uuid.UUID, *, replace: bool = False
) -> int:
    """Скачать audio из S3 → STT → сегменты. 0 если нечего делать / ошибка.

    `replace=True` — прогон по кнопке «Распознать заново»: существующий
    транскрипт не повод пропустить работу, он будет перезаписан.
    """
    from app.integrations.s3 import get_s3_adapter
    from app.modules.screening.offline_stt import OfflineSttError, transcribe_audio_bytes

    settings = get_settings()
    if not (settings.stt_url or "").strip():
        logger.info("screening.offline: STT_URL empty — skip %s", session_id)
        return 0

    async with SessionLocal() as db:
        session = await db.get(ScreeningSession, session_id)
        if session is None:
            return 0
        if session.audio_file_id is None:
            logger.info("screening.offline: no audio for %s", session_id)
            return 0
        if not replace and await _segment_count(db, session_id) > 0:
            logger.info("screening.offline: segments already exist for %s", session_id)
            return 0
        file = await db.get(File, session.audio_file_id)
        if file is None:
            logger.warning("screening.offline: file missing for %s", session_id)
            return 0
        file_key = file.file_key

    try:
        s3 = get_s3_adapter()
        audio = await asyncio.to_thread(s3.download_bytes, file_key=file_key)
    except Exception:
        logger.exception("screening.offline: S3 download failed for %s", session_id)
        return 0

    try:
        items = await transcribe_audio_bytes(audio, settings.stt_url)
    except OfflineSttError as exc:
        logger.warning("screening.offline: STT failed for %s (%s)", session_id, exc)
        return 0
    except Exception:
        logger.exception("screening.offline: unexpected STT error for %s", session_id)
        return 0

    async with SessionLocal() as db:
        n = await insert_offline_segments(db, session_id, items, replace=replace)
    logger.info("screening.offline: wrote %d segment(s) for %s", n, session_id)
    return n


# --- report / post-analysis (Этап 5) ---------------------------------------


async def get_report(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> ScreeningReportDTO:
    await _require_view_report(db, user)
    session = await _load(db, session_id)
    await _ensure_can_see(db, user, session)
    report = (
        await db.execute(
            select(ScreeningReport).where(ScreeningReport.session_id == session_id)
        )
    ).scalar_one_or_none()
    if report is None:
        raise NotFound("Отчёт ещё не готов")
    return ScreeningReportDTO.model_validate(report)


def _question_payload(q: ScreeningQuestion) -> dict:
    return {
        "text": q.text_,
        "status": q.status.value if hasattr(q.status, "value") else str(q.status),
        "answer_summary": q.answer_summary,
        "goal": q.goal,
    }


def _segment_payload(seg: ScreeningSegment) -> dict:
    return {
        "speaker": seg.speaker.value if hasattr(seg.speaker, "value") else str(seg.speaker),
        "text": seg.text_,
        "started_ms": seg.started_ms,
        "ended_ms": seg.ended_ms,
    }


async def _notify_analysis_failed(
    *,
    session_id: uuid.UUID,
    recruiter_id: uuid.UUID | None,
    candidate_id: uuid.UUID,
    vacancy_id: uuid.UUID | None,
    candidate_name: str,
) -> None:
    """Сообщить рекрутеру, что отчёт не собрался, и обновить карточку по WS.

    Общая ветка для всех путей провала пост-анализа (сбой LLM, сбой записи
    отчёта, уборщик залипших processing) — чтобы тексты и события не разошлись.
    Уведомление шлём в отдельной сессии: вызывающая может быть в rollback.
    """
    if recruiter_id is not None:
        try:
            async with SessionLocal() as ndb:
                await notify_service.notify(
                    ndb,
                    recipient_id=recruiter_id,
                    kind=NotificationKind.system,
                    text=(
                        "Не удалось сформировать отчёт AI-скрининга по "
                        f"«{candidate_name}». Статус сессии: ошибка."
                    ),
                    entity_type=NotificationEntityType.candidate,
                    entity_id=candidate_id,
                    payload={"screeningId": str(session_id)},
                )
                await ndb.commit()
        except Exception:
            logger.exception(
                "screening.analysis: notify on error failed for %s", session_id
            )
    publish_screening_report_ready(
        session_id=session_id,
        candidate_id=candidate_id,
        vacancy_id=vacancy_id,
        status=ScreeningStatus.error.value,
        actor_id=recruiter_id,
    )


async def _persist_report(
    db: AsyncSession,
    session_id: uuid.UUID,
    raw: dict,
    *,
    existing: ScreeningReport | None,
) -> None:
    """Записать отчёт, пережив гонку на UNIQUE(session_id).

    Параллельные пути реальны: finish → пост-анализ и одновременно GET →
    авто-офлайн-STT → тот же анализ по другой задаче. Вставку делаем в
    savepoint: если конкурент успел первым, ловим IntegrityError (внешняя
    транзакция цела) и дописываем его строку вместо своей.
    """
    fields = {
        "summary": raw["summary"],
        "verdict": raw["verdict"],
        "scores": raw.get("scores"),
        "red_flags": raw.get("red_flags"),
        "recommendation": raw.get("recommendation"),
        "model": raw.get("model"),
        "prompt_version": raw.get("prompt_version"),
    }
    if existing is None:
        report = ScreeningReport(session_id=session_id, **fields)
        try:
            # add ВНУТРИ savepoint: иначе его откат не выкинет объект из
            # сессии и следующий flush повторит тот же обречённый INSERT.
            async with db.begin_nested():
                db.add(report)
                await db.flush()
            return
        except IntegrityError:
            if report in db.sync_session:
                db.expunge(report)
            existing = (
                await db.execute(
                    select(ScreeningReport).where(
                        ScreeningReport.session_id == session_id
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                raise  # не гонка на UNIQUE — пусть разбирается вызывающий
            logger.info(
                "screening.analysis: report for %s inserted by a parallel task "
                "— обновляем существующую строку",
                session_id,
            )
    for key, value in fields.items():
        setattr(existing, key, value)


async def run_post_analysis(
    session_id: uuid.UUID, *, replace_report: bool = False
) -> None:
    """Собрать отчёт по сессии (вызывается из Celery / eager-task).

    Идемпотентно: если отчёт уже есть — no-op (кроме `replace_report=True`
    после офлайн-STT с новыми сегментами). Уведомление — только при первом
    появлении отчёта, иначе поллинг/повтор задачи заливает inbox.
    При сбое AI пишет fallback-отчёт; при неожиданной ошибке — status=error.
    """
    async with SessionLocal() as db:
        session = (
            await db.execute(
                select(ScreeningSession)
                .where(ScreeningSession.id == session_id)
                .options(selectinload(ScreeningSession.questions))
            )
        ).scalar_one_or_none()
        if session is None:
            logger.warning("screening.analysis: session %s not found", session_id)
            return

        existing = (
            await db.execute(
                select(ScreeningReport).where(ScreeningReport.session_id == session_id)
            )
        ).scalar_one_or_none()
        had_report = existing is not None

        # Дубликат задачи (поллинг / повторный enqueue): отчёт есть и менять
        # не просили — добиваем status=done и выходим без notify.
        if had_report and not replace_report:
            if session.status != ScreeningStatus.done:
                session.status = ScreeningStatus.done
                await db.commit()
            return

        if session.status not in (
            ScreeningStatus.processing,
            ScreeningStatus.done,
            ScreeningStatus.error,
        ):
            logger.info(
                "screening.analysis: skip %s (status=%s)",
                session_id,
                session.status,
            )
            return

        cand = await db.get(Candidate, session.candidate_id)
        if cand is None:
            session.status = ScreeningStatus.error
            await db.commit()
            return
        vac = (
            await db.get(Vacancy, session.vacancy_id)
            if session.vacancy_id is not None
            else None
        )
        segments = list(
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
        questions = list(session.questions)
        q_payloads = [_question_payload(q) for q in questions]
        seg_payloads = [_segment_payload(s) for s in segments]
        transcript_chars = sum(len(s.text_ or "") for s in segments)
        answered = sum(
            1 for q in questions if q.status == ScreeningQuestionStatus.answered
        )
        # Значения снимаем ДО любых commit: после коммита ORM-объекты
        # инвалидируются (expire_on_commit) и ленивая подгрузка в async-контексте
        # даёт MissingGreenlet прямо в обработчике ошибки.
        cand_name = cand.full_name
        recruiter_id = session.recruiter_id
        candidate_id = session.candidate_id
        vacancy_id = session.vacancy_id
        vac_title = vac.title if vac is not None else None
        sid = session.id

        try:
            # Нет улик встречи (транскрипт + краткие ответы) → без LLM.
            # Иначе модель раньше подменяла отчёт пересказом резюме/вакансии.
            answer_chars = sum(len(q.answer_summary or "") for q in questions)
            ev_chars = transcript_chars + answer_chars
            if ev_chars < screening_report.MIN_EVIDENCE_CHARS:
                logger.info(
                    "screening.analysis: no meeting evidence for %s "
                    "(transcript=%s, answers=%s) — fallback",
                    session_id,
                    transcript_chars,
                    answer_chars,
                )
                screening_metrics.record_ai_report_fallback()
                raw = screening_report.fallback_report(
                    transcript_chars=transcript_chars,
                    answered_questions=answered,
                    total_questions=len(questions),
                )
            else:
                raw = await screening_report.generate_screening_report(
                    questions=q_payloads,
                    segments=seg_payloads,
                )
        except (screening_report.AiUnavailableError, screening_report.AiBadRequestError) as exc:
            logger.warning(
                "screening.analysis: AI failed for %s (%s) — fallback",
                session_id,
                exc,
            )
            screening_metrics.record_ai_report_fallback()
            raw = screening_report.fallback_report(
                transcript_chars=transcript_chars,
                answered_questions=answered,
                total_questions=len(questions),
            )
        except Exception:
            logger.exception("screening.analysis: unexpected error for %s", session_id)
            screening_metrics.record_ai_report_error()
            session.status = ScreeningStatus.error
            await db.commit()
            await _notify_analysis_failed(
                session_id=sid,
                recruiter_id=recruiter_id,
                candidate_id=candidate_id,
                vacancy_id=vacancy_id,
                candidate_name=cand_name,
            )
            return

        actor_id = recruiter_id
        verdict: ScreeningVerdict = raw["verdict"]
        verdict_label = _VERDICT_LABELS.get(verdict, verdict.value)
        activity_text = (
            f"AI-скрининг завершён: вердикт «{verdict_label}»"
            + (f" ({vac_title})" if vac_title else "")
        )
        # Запись отчёта + activity + notify раньше жили вне try/except: любая
        # ошибка здесь (гонка на UNIQUE, недоступный БД-коннект, падение
        # notify) улетала наружу, глоталась в tasks.py и оставляла сессию в
        # processing навсегда. Теперь провал этой части = честный error.
        try:
            await _persist_report(db, sid, raw, existing=existing)
            session.status = ScreeningStatus.done
            # Activity + notify только при первом отчёте: replace после
            # офлайн-STT обновляет карточку через WS, без второго (десятого)
            # колокольчика.
            if actor_id is not None and not had_report:
                await audit_service.record_activity(
                    db,
                    entity_type=ActivityEntityType.candidate,
                    entity_id=candidate_id,
                    actor_id=actor_id,
                    kind=ActivityKind.note,
                    text=activity_text,
                )
                await notify_service.notify(
                    db,
                    recipient_id=actor_id,
                    kind=NotificationKind.system,
                    text=(
                        f"Отчёт AI-скрининга по «{cand_name}» готов: "
                        f"«{verdict_label}»."
                    ),
                    entity_type=NotificationEntityType.candidate,
                    entity_id=candidate_id,
                    payload={
                        "screeningId": str(sid),
                        "verdict": verdict.value,
                    },
                )
            await db.commit()
        except Exception:
            logger.exception(
                "screening.analysis: report persist failed for %s", session_id
            )
            screening_metrics.record_ai_report_error()
            await db.rollback()
            try:
                # Точечный UPDATE, а не ORM-объект: после rollback его
                # состояние доверия не заслуживает.
                await db.execute(
                    sa_update(ScreeningSession)
                    .where(ScreeningSession.id == sid)
                    .values(status=ScreeningStatus.error)
                )
                await db.commit()
            except Exception:
                logger.exception(
                    "screening.analysis: cannot mark %s as error", session_id
                )
            await _notify_analysis_failed(
                session_id=sid,
                recruiter_id=recruiter_id,
                candidate_id=candidate_id,
                vacancy_id=vacancy_id,
                candidate_name=cand_name,
            )
            return

        screening_metrics.record_ai_report_ok()
        publish_screening_report_ready(
            session_id=sid,
            candidate_id=candidate_id,
            vacancy_id=vacancy_id,
            status=ScreeningStatus.done.value,
            verdict=verdict.value,
            actor_id=actor_id,
        )
        logger.info(
            "screening.analysis: report ready for %s (verdict=%s, model=%s)",
            session_id,
            verdict.value,
            raw.get("model"),
        )


# --- hard-stop / retention (Этап 6) -----------------------------------------


async def finish_by_timeout(session_id: uuid.UUID) -> None:
    """Завершить live-сессию по SCREENING_MAX_DURATION_MIN (из WS).

    Без проверки пользователя: вызывается серверным hard-stop.
    """
    async with SessionLocal() as db:
        session = await db.get(ScreeningSession, session_id)
        if session is None or session.status != ScreeningStatus.live:
            return
        session.status = ScreeningStatus.processing
        session.ended_at = datetime.now(UTC)
        if session.started_at is not None:
            session.duration_sec = int(
                (session.ended_at - session.started_at).total_seconds()
            )
        await _enqueue_post_meeting(db, session)
        await db.commit()
    screening_metrics.record_max_duration_stop()
    logger.warning("screening.finish_by_timeout: session %s", session_id)


async def touch_session_activity(session_id: uuid.UUID) -> None:
    """Отметить, что по сессии есть живой WS (для уборщика осиротевших live)."""
    try:
        async with SessionLocal() as db:
            await db.execute(
                sa_update(ScreeningSession)
                .where(ScreeningSession.id == session_id)
                .values(last_seen_at=datetime.now(UTC))
            )
            await db.commit()
    except Exception:  # noqa: BLE001 — heartbeat не должен ронять встречу
        logger.exception("screening.touch: failed for %s", session_id)


def _aware(dt: datetime | None) -> datetime | None:
    """UTC-aware datetime (в БД могут лежать naive значения)."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


# Дедуп повторной постановки анализа для залипших processing: беат ходит раз в
# минуту, а «переставить один раз» нужно на весь таймаут. Держим в памяти
# процесса сознательно — сама задача анализа идемпотентна, поэтому дубль после
# рестарта воркера безопасен, а колонка в БД ради этого не нужна.
_REQUEUED_PROCESSING: dict[uuid.UUID, datetime] = {}


async def _requeue_stuck_analysis(session_id: uuid.UUID) -> None:
    """Переставить пост-анализ у сессии, залипшей в processing."""
    async with SessionLocal() as db:
        session = await db.get(ScreeningSession, session_id)
        if session is None or session.status != ScreeningStatus.processing:
            return
        await _enqueue_post_meeting(db, session)
        await db.commit()
    logger.warning("screening.sweeper: re-queued analysis for stuck %s", session_id)


async def _fail_stuck_processing(session_id: uuid.UUID) -> None:
    """Сессия висит в processing втрое дольше таймаута — фиксируем ошибку."""
    async with SessionLocal() as db:
        session = await db.get(ScreeningSession, session_id)
        if session is None or session.status != ScreeningStatus.processing:
            return
        recruiter_id = session.recruiter_id
        candidate_id = session.candidate_id
        vacancy_id = session.vacancy_id
        cand = await db.get(Candidate, candidate_id)
        cand_name = cand.full_name if cand is not None else "кандидату"
        session.status = ScreeningStatus.error
        await db.commit()
    screening_metrics.record_ai_report_error()
    await _notify_analysis_failed(
        session_id=session_id,
        recruiter_id=recruiter_id,
        candidate_id=candidate_id,
        vacancy_id=vacancy_id,
        candidate_name=cand_name,
    )
    logger.error(
        "screening.sweeper: stuck processing %s → error (analysis never finished)",
        session_id,
    )


async def _sweep_stuck_processing(now: datetime, timeout_min: int) -> int:
    """Разобрать сессии, залипшие в processing (см. close_stale_sessions)."""
    requeue: list[uuid.UUID] = []
    fail: list[uuid.UUID] = []
    # Чистим отметки давно уехавших сессий: беат живёт неделями, а словарь
    # иначе растёт на каждую встречу.
    ttl = timedelta(minutes=timeout_min * 3)
    for sid, marked in list(_REQUEUED_PROCESSING.items()):
        if (now - marked) > ttl:
            _REQUEUED_PROCESSING.pop(sid, None)
    async with SessionLocal() as db:
        rows = list(
            (
                await db.execute(
                    select(ScreeningSession).where(
                        ScreeningSession.status == ScreeningStatus.processing
                    )
                )
            )
            .scalars()
            .all()
        )
    for s in rows:
        anchors = [
            a for a in (_aware(s.ended_at), _aware(s.updated_at), _aware(s.started_at))
            if a is not None
        ]
        if not anchors:
            continue
        age = now - max(anchors)
        if age > timedelta(minutes=timeout_min * 3):
            fail.append(s.id)
        elif age > timedelta(minutes=timeout_min):
            last = _REQUEUED_PROCESSING.get(s.id)
            if last is None or (now - last) > timedelta(minutes=timeout_min):
                requeue.append(s.id)

    for sid in requeue:
        try:
            await _requeue_stuck_analysis(sid)
            _REQUEUED_PROCESSING[sid] = now
        except Exception:
            logger.exception("screening.sweeper: re-queue failed for %s", sid)
    for sid in fail:
        _REQUEUED_PROCESSING.pop(sid, None)
        try:
            await _fail_stuck_processing(sid)
        except Exception:
            logger.exception("screening.sweeper: fail-stuck failed for %s", sid)
    return len(requeue) + len(fail)


async def close_stale_sessions() -> int:
    """Закрыть «осиротевшие» live-сессии (Этап 6, беат раз в минуту).

    Две причины:
    1) превышен SCREENING_MAX_DURATION_MIN — hard-stop обязан отработать даже
       если WS давно оборван (внутри WS-таска он умирает вместе с соединением);
    2) от клиента нет активности дольше SCREENING_ORPHAN_GRACE_MIN — рекрутер
       закрыл вкладку и не вернулся; иначе сессия висит live навсегда и отчёт
       не строится.

    Плюс залипшие processing: задача пост-анализа могла потеряться (воркер
    упал / Redis мигнул), и без этого сессия крутила «обработку» вечно.
    """
    settings = get_settings()
    now = datetime.now(UTC)
    # 0 = «не закрывать» по документации конфига; прежний max(1, ...) превращал
    # это ровно в обратное — закрывать через минуту простоя.
    grace_min = int(settings.screening_orphan_grace_min)
    max_min = int(settings.screening_max_duration_min)

    stale_ids: list[uuid.UUID] = []
    async with SessionLocal() as db:
        rows = list(
            (
                await db.execute(
                    select(ScreeningSession).where(
                        ScreeningSession.status == ScreeningStatus.live
                    )
                )
            )
            .scalars()
            .all()
        )
        for s in rows:
            started = _aware(s.started_at or s.created_at)
            stale = False
            if grace_min > 0:
                anchor = _aware(s.last_seen_at or s.started_at or s.created_at)
                stale = (
                    anchor is not None
                    and (now - anchor) > timedelta(minutes=grace_min)
                )
            overlong = (
                max_min > 0
                and started is not None
                and (now - started) > timedelta(minutes=max_min)
            )
            if stale or overlong:
                stale_ids.append(s.id)

    for sid in stale_ids:
        try:
            await finish_by_timeout(sid)
        except Exception:
            logger.exception("screening.sweeper: finish failed for %s", sid)
    if stale_ids:
        logger.warning("screening.sweeper: closed %d stale session(s)", len(stale_ids))

    touched = len(stale_ids)
    processing_timeout = int(settings.screening_processing_timeout_min)
    if processing_timeout > 0:
        # Терпение уборщика обязано перекрывать хард-лимит celery: иначе он
        # ставит вторую задачу поверх ещё живого офлайн-STT (повторный Whisper
        # и повторный LLM за те же деньги), а потом метит рабочую сессию как
        # error. В .env это значение правят руками, так что не доверяем ему.
        floor = int(settings.screening_task_time_limit_min) + 10
        if processing_timeout < floor:
            logger.warning(
                "screening.sweeper: SCREENING_PROCESSING_TIMEOUT_MIN=%d меньше "
                "хард-лимита задачи — поднимаю до %d",
                processing_timeout,
                floor,
            )
            processing_timeout = floor
        touched += await _sweep_stuck_processing(now, processing_timeout)
    return touched


async def purge_expired_audio(
    db: AsyncSession,
    s3: S3Adapter,
    retention_days: int | None = None,
) -> int:
    """Удалить аудио скрининга старше retention (coalesce(ended_at, created_at)).

    Транскрипт и отчёт не трогаем. `retention_days=0` / конфиг 0 — no-op.

    Вторая фаза подметает «осиротевшие» файлы entity_type=screening, у которых
    сессии уже нет (её удалили, а S3 в тот момент был недоступен): по сессиям
    их не найти, а лежать в бакете дольше retention они не имеют права.
    """
    settings = get_settings()
    days = (
        settings.screening_audio_retention_days
        if retention_days is None
        else retention_days
    )
    if days <= 0:
        return 0
    cutoff = datetime.now(UTC) - timedelta(days=days)
    anchor = func.coalesce(ScreeningSession.ended_at, ScreeningSession.created_at)
    sessions = list(
        (
            await db.execute(
                select(ScreeningSession).where(
                    ScreeningSession.audio_file_id.is_not(None),
                    anchor < cutoff,
                )
            )
        )
        .scalars()
        .all()
    )
    file_ids = [s.audio_file_id for s in sessions if s.audio_file_id is not None]
    files: dict[uuid.UUID, File] = {}
    if file_ids:
        rows = (
            (await db.execute(select(File).where(File.id.in_(file_ids))))
            .scalars()
            .all()
        )
        files = {f.id: f for f in rows}

    purged = 0
    for session in sessions:
        file_id = session.audio_file_id
        if file_id is None:
            continue
        file = files.get(file_id)
        if file is not None:
            if file.entity_type != FileEntityType.screening:
                logger.warning(
                    "screening.retention: file %s is not a screening file — skip",
                    file_id,
                )
                continue
            try:
                # s3.delete синхронный: в потоке, чтобы не блокировать loop.
                await asyncio.to_thread(s3.delete, file_key=file.file_key)
            except Exception:
                logger.exception(
                    "screening.retention: S3 delete failed for %s", file.file_key
                )
                continue
            await db.delete(file)
        session.audio_file_id = None
        # Коммит на каждый файл: падение в середине батча не оставит
        # удалённые в S3 объекты с живыми строками в БД.
        await db.commit()
        purged += 1

    purged += await _purge_orphan_audio(db, s3, cutoff)
    if purged:
        screening_metrics.record_retention_purged(purged)
    return purged


async def _purge_orphan_audio(
    db: AsyncSession, s3: S3Adapter, cutoff: datetime
) -> int:
    """Фаза 2 retention: файлы скрининга без сессии, старше cutoff."""
    orphans = list(
        (
            await db.execute(
                select(File).where(
                    File.entity_type == FileEntityType.screening,
                    File.created_at < cutoff,
                    ~select(ScreeningSession.id)
                    .where(ScreeningSession.id == File.entity_id)
                    .exists(),
                    ~select(ScreeningSession.id)
                    .where(ScreeningSession.audio_file_id == File.id)
                    .exists(),
                )
            )
        )
        .scalars()
        .all()
    )
    swept = 0
    for file in orphans:
        try:
            await asyncio.to_thread(s3.delete, file_key=file.file_key)
        except Exception:
            logger.exception(
                "screening.retention: S3 delete failed for orphan %s", file.file_key
            )
            continue
        await db.delete(file)
        await db.commit()
        swept += 1
    if swept:
        logger.warning("screening.retention: swept %d orphan audio file(s)", swept)
    return swept

