"""DTO модуля screening.

Контракт с фронтом — camelCase (CamelModel). Список сессий отдаётся «толстым»
(candidateName / vacancyTitle / recruiterName), чтобы страница раздела не
делала N доп-запросов — по perf-паттернам проекта.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.core.schemas import CamelModel
from app.modules.screening.models import (
    ScreeningQuestionSource,
    ScreeningQuestionStatus,
    ScreeningSpeaker,
    ScreeningStatus,
    ScreeningVerdict,
)


class ScreeningQuestionDTO(CamelModel):
    id: uuid.UUID
    position: int
    text: str
    goal: str | None = None
    source: ScreeningQuestionSource
    status: ScreeningQuestionStatus
    answer_summary: str | None = None


class ScreeningSegmentDTO(CamelModel):
    id: uuid.UUID
    seq: int
    speaker: ScreeningSpeaker
    text: str
    started_ms: int
    ended_ms: int


class ScreeningReportDTO(CamelModel):
    id: uuid.UUID
    summary: str
    verdict: ScreeningVerdict
    scores: dict | None = None
    red_flags: list | None = None
    recommendation: str | None = None
    model: str | None = None
    created_at: datetime


class ScreeningSessionResponse(CamelModel):
    id: uuid.UUID
    candidate_id: uuid.UUID
    vacancy_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None
    recruiter_id: uuid.UUID | None = None
    status: ScreeningStatus
    telemost_url: str | None = None
    consent_confirmed: bool = False
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_sec: int | None = None
    audio_file_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    questions: list[ScreeningQuestionDTO] = []
    # Денормализованные подписи (не ORM-поля).
    candidate_name: str | None = None
    vacancy_title: str | None = None
    recruiter_name: str | None = None
    report: ScreeningReportDTO | None = None


class ScreeningListResponse(CamelModel):
    items: list[ScreeningSessionResponse]
    total: int
    page: int
    page_size: int


class CreateScreeningRequest(CamelModel):
    candidate_id: uuid.UUID
    vacancy_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None
    telemost_url: str | None = None
    # Стартовый список вопросов (рекрутер может вбить руками при создании).
    # Если пусто и generate_questions=true — бэкенд вызовет YandexGPT (Этап 3).
    questions: list[str] = []
    generate_questions: bool = True


class UpdateScreeningRequest(CamelModel):
    telemost_url: str | None = None
    consent_confirmed: bool | None = None


class FinishScreeningRequest(CamelModel):
    # Длительность считает клиент по своему таймеру — отрицательное значение
    # (перевод часов / кривой клиент) попадало в карточку и в аналитику.
    duration_sec: int | None = Field(default=None, ge=0)


class AttachAudioRequest(CamelModel):
    file_id: uuid.UUID


class TranscriptResponse(CamelModel):
    items: list[ScreeningSegmentDTO]
    last_seq: int


class AddQuestionRequest(CamelModel):
    # Вопрос уезжает в промпт пост-анализа: без потолка одна вставка «всего
    # резюме» выносит контекст модели.
    text: str = Field(max_length=2000)
    goal: str | None = None
    position: int | None = None  # None → в конец


class UpdateQuestionRequest(CamelModel):
    text: str | None = None
    goal: str | None = None
    status: ScreeningQuestionStatus | None = None
    position: int | None = None


class RegenerateQuestionsRequest(CamelModel):
    """Перегенерация плана вопросов (только draft)."""

    # Сколько вопросов просить у модели; None → дефолт из screening/ai.py.
    count: int | None = None
    # true → убрать и ручные вопросы; false → сохранить source=manual.
    replace_manual: bool = False
