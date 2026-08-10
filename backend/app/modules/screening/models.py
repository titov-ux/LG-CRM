"""SQLAlchemy-модели AI-скрининга (видеоинтервью в Телемосте).

См. «План_AI_скрининга.docx» (корень репо). Этап 1: сессии, чек-лист вопросов,
сегменты транскрипта, отчёт. Realtime-пайплайн (WS + stt-service) — Этап 2,
AI-наполнение вопросов/отчёта — Этапы 3–5; модель данных заложена сразу.

Связи:
* `candidate_id` — обязательная (скрининг всегда про кандидата), CASCADE:
  permanent-удаление кандидата уносит и его скрининги;
* `vacancy_id` / `match_id` — опциональные, SET NULL (скрининг переживает
  удаление вакансии/связки как «исторический» артефакт);
* `recruiter_id` (автор/ведущий) — SET NULL по паттерну миграции 0011;
* `audio_file_id` — файл записи в S3 (files, entity_type=screening).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampsMixin


class ScreeningStatus(str, enum.Enum):
    draft = "draft"          # создан, идёт подготовка вопросов
    live = "live"            # встреча идёт, аудио стримится
    processing = "processing"  # встреча закончена, пост-анализ в работе
    done = "done"            # отчёт готов (или пост-анализ пропущен)
    error = "error"          # пайплайн упал; детали — в отчёте/логах


class ScreeningSpeaker(str, enum.Enum):
    recruiter = "recruiter"  # канал 0 — микрофон
    candidate = "candidate"  # канал 1 — звук вкладки Телемоста


class ScreeningQuestionSource(str, enum.Enum):
    pregenerated = "pregenerated"  # сгенерирован AI до встречи (Этап 3)
    followup = "followup"          # предложен AI по ходу встречи (Этап 4)
    manual = "manual"              # добавлен рекрутером руками


class ScreeningQuestionStatus(str, enum.Enum):
    pending = "pending"    # ещё не задан
    asked = "asked"        # задан, ответ не зафиксирован
    answered = "answered"  # получен содержательный ответ
    skipped = "skipped"    # осознанно пропущен / снят AI


class ScreeningVerdict(str, enum.Enum):
    fit = "fit"
    partial_fit = "partial_fit"
    no_fit = "no_fit"


def _enum_values(e):
    return [m.value for m in e]


class ScreeningSession(Base, TimestampsMixin):
    __tablename__ = "screening_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    vacancy_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vacancies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    match_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vacancy_candidates.id", ondelete="SET NULL"),
        nullable=True,
    )
    recruiter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[ScreeningStatus] = mapped_column(
        Enum(ScreeningStatus, name="screening_status", values_callable=_enum_values),
        nullable=False,
        default=ScreeningStatus.draft,
        index=True,
    )
    telemost_url: Mapped[str | None] = mapped_column(Text(), nullable=True)
    # Рекрутер подтверждает, что получил согласие кандидата на запись и
    # обработку (152-ФЗ). Без него сессию нельзя перевести в live.
    consent_confirmed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    audio_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("files.id", ondelete="SET NULL"),
        nullable=True,
    )

    questions: Mapped[list["ScreeningQuestion"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ScreeningQuestion.position",
    )


class ScreeningQuestion(Base, TimestampsMixin):
    """Живой чек-лист вопросов сессии. На Этапах 3–4 наполняется AI."""

    __tablename__ = "screening_questions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("screening_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_: Mapped[str] = mapped_column("text", Text(), nullable=False)
    # Зачем задаём вопрос — подсказка рекрутеру (заполнит AI на Этапе 3).
    goal: Mapped[str | None] = mapped_column(Text(), nullable=True)
    source: Mapped[ScreeningQuestionSource] = mapped_column(
        Enum(
            ScreeningQuestionSource,
            name="screening_question_source",
            values_callable=_enum_values,
        ),
        nullable=False,
        default=ScreeningQuestionSource.manual,
    )
    status: Mapped[ScreeningQuestionStatus] = mapped_column(
        Enum(
            ScreeningQuestionStatus,
            name="screening_question_status",
            values_callable=_enum_values,
        ),
        nullable=False,
        default=ScreeningQuestionStatus.pending,
    )
    # Краткое содержание ответа кандидата (заполнит AI на Этапе 4).
    answer_summary: Mapped[str | None] = mapped_column(Text(), nullable=True)

    session: Mapped[ScreeningSession] = relationship(back_populates="questions")


class ScreeningSegment(Base):
    """Финальный сегмент транскрипта (partial-гипотезы в БД не пишем).

    `seq` — сквозной номер в рамках сессии; вместе с UNIQUE защищает от
    дублей при reconnect WS (Этап 2).
    """

    __tablename__ = "screening_segments"
    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_screening_segment_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("screening_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker: Mapped[ScreeningSpeaker] = mapped_column(
        Enum(ScreeningSpeaker, name="screening_speaker", values_callable=_enum_values),
        nullable=False,
    )
    text_: Mapped[str] = mapped_column("text", Text(), nullable=False)
    started_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    ended_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class ScreeningReport(Base, TimestampsMixin):
    """Итог пост-анализа встречи (Этап 5). UNIQUE(session_id) — один отчёт."""

    __tablename__ = "screening_reports"
    __table_args__ = (
        UniqueConstraint("session_id", name="uq_screening_report_session"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("screening_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    summary: Mapped[str] = mapped_column(Text(), nullable=False)
    verdict: Mapped[ScreeningVerdict] = mapped_column(
        Enum(ScreeningVerdict, name="screening_verdict", values_callable=_enum_values),
        nullable=False,
    )
    # {"communication": {"score": 4, "note": "..."}, ...} — рубрики согласуем
    # перед Этапом 5 (см. «Открытые вопросы» в плане).
    scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    red_flags: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    recommendation: Mapped[str | None] = mapped_column(Text(), nullable=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
