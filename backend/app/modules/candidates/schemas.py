"""DTO модуля candidates.

Резюме-поля (`skillCategories`/`experience`/`education`/`certifications`/`languages`)
живут в БД одной JSONB-колонкой `resume`, но фронту отдаются как плоские
поля верхнего уровня — этого ждёт `frontend/src/api/types.ts:Candidate`.

Сборка/разборка между БД и DTO — в сервисе.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import EmailStr, Field

from app.core.schemas import CamelModel
from app.modules.candidates.models import CandidateStatus, EmploymentType
from app.modules.vacancies.models import EngagementType, Grade, WorkFormat


# ─── Резюме-блоки (зеркала фронтовых типов) ───
class SkillCategory(CamelModel):
    id: str
    name: str
    items: list[str] = Field(default_factory=list)


class CandidateExperience(CamelModel):
    id: str
    company: str
    position: str
    start_month: str  # YYYY-MM
    end_month: str | None = None
    project: str | None = None
    achievements: list[str] = Field(default_factory=list)
    stack: list[str] = Field(default_factory=list)


class CandidateEducation(CamelModel):
    id: str
    degree: str
    institution: str
    city: str | None = None
    graduation_year: int
    specialty: str | None = None


class CandidateCertification(CamelModel):
    id: str
    title: str
    issuer: str
    period: str | None = None


LanguageLevel = Literal["A1", "A2", "B1", "B2", "C1", "C2", "родной"]


class CandidateLanguage(CamelModel):
    language: str
    level: LanguageLevel


# ─── Candidate DTO ───
class CandidateResponse(CamelModel):
    id: uuid.UUID
    full_name: str
    role: str
    engagement_type: EngagementType
    grade: Grade
    experience_years: float
    stack: list[str] = Field(default_factory=list)
    rate_month: float | None = None
    employment_type: EmploymentType
    format: WorkFormat
    location: str
    # nullable: если рекрутер удалён, поле сбрасывается в null (см. миграцию 0011).
    recruiter_id: uuid.UUID | None = None
    status: CandidateStatus
    days_in_status: int
    vacancy_ids: list[uuid.UUID] = Field(default_factory=list)
    telegram: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    birthday: date | None = None
    kanban_order: int = 0
    summary: str | None = None
    skill_categories: list[SkillCategory] | None = None
    experience: list[CandidateExperience] | None = None
    education: list[CandidateEducation] | None = None
    certifications: list[CandidateCertification] | None = None
    languages: list[CandidateLanguage] | None = None
    archived: bool = False
    archived_at: datetime | None = None
    archived_by_id: uuid.UUID | None = None
    archive_reason: str | None = None


class CreateCandidateRequest(CamelModel):
    full_name: str = Field(min_length=1)
    role: str = ""
    engagement_type: EngagementType = EngagementType.outstaff
    grade: Grade = Grade.middle
    experience_years: float = 0
    stack: list[str] = Field(default_factory=list)
    rate_month: float | None = None
    employment_type: EmploymentType = EmploymentType.smz
    format: WorkFormat = WorkFormat.hybrid
    location: str = ""
    # При создании рекрутер опционален — карточку можно завести и без ответственного.
    recruiter_id: uuid.UUID | None = None
    status: CandidateStatus = CandidateStatus.new
    telegram: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    birthday: date | None = None
    summary: str | None = None
    skill_categories: list[SkillCategory] | None = None
    experience: list[CandidateExperience] | None = None
    education: list[CandidateEducation] | None = None
    certifications: list[CandidateCertification] | None = None
    languages: list[CandidateLanguage] | None = None


class UpdateCandidateRequest(CamelModel):
    full_name: str | None = None
    role: str | None = None
    engagement_type: EngagementType | None = None
    grade: Grade | None = None
    experience_years: float | None = None
    stack: list[str] | None = None
    rate_month: float | None = None
    employment_type: EmploymentType | None = None
    format: WorkFormat | None = None
    location: str | None = None
    recruiter_id: uuid.UUID | None = None
    telegram: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    birthday: date | None = None
    summary: str | None = None
    skill_categories: list[SkillCategory] | None = None
    experience: list[CandidateExperience] | None = None
    education: list[CandidateEducation] | None = None
    certifications: list[CandidateCertification] | None = None
    languages: list[CandidateLanguage] | None = None


class ChangeCandidateStatusRequest(CamelModel):
    status: CandidateStatus
    comment: str | None = None


class CandidateKanbanUpdate(CamelModel):
    id: uuid.UUID
    status: CandidateStatus
    kanban_order: int


class CandidateKanbanOrderRequest(CamelModel):
    updates: list[CandidateKanbanUpdate]


class ArchiveRequest(CamelModel):
    reason: str | None = None


class CandidatePage(CamelModel):
    items: list[CandidateResponse]
    total: int
    page: int
    page_size: int


# ────────────────────────────────────────────────────────────────────────────
# AI-распознавание резюме
# ────────────────────────────────────────────────────────────────────────────


class ParseResumeTextRequest(CamelModel):
    # 150к: HH-PDF на 10-12 страниц даёт 45-50к символов, а прежний лимит
    # 50к отбивал такие резюме 422-й ещё до AI. Парсер режет большие резюме
    # на чанки (см. ai.py), так что верхняя граница — только санитарная.
    text: str = Field(min_length=1, max_length=150_000)


# Резюме-блоки для распознавания. ВНИМАНИЕ: эти схемы похожи на
# CandidateExperience/CandidateEducation/CandidateCertification/CandidateLanguage,
# но без поля `id` — фронт сам сгенерирует id при подстановке в форму.
class ParsedSkillCategory(CamelModel):
    name: str
    items: list[str] = Field(default_factory=list)


class ParsedExperience(CamelModel):
    company: str = ""
    position: str = ""
    start_month: str = ""  # YYYY-MM
    end_month: str = ""  # YYYY-MM или "" = «по настоящее время»
    project: str = ""
    achievements: list[str] = Field(default_factory=list)
    stack: list[str] = Field(default_factory=list)


class ParsedEducation(CamelModel):
    degree: str = "Высшее"
    institution: str
    city: str = ""
    graduation_year: int
    specialty: str = ""


class ParsedCertification(CamelModel):
    title: str
    issuer: str
    period: str = ""


class ParsedLanguage(CamelModel):
    language: str
    level: LanguageLevel


class ParsedCandidate(CamelModel):
    """Структурированный результат распознавания (все поля опциональны).

    Используется только как ответ AI-эндпоинта; фронт мержит непустые значения
    поверх формы. employmentType / engagementType / recruiterId не парсятся
    из резюме — их выставляет рекрутер.
    """

    full_name: str | None = None
    role: str | None = None
    grade: Grade | None = None
    experience_years: float | None = None
    format: WorkFormat | None = None
    rate_month: float | None = None
    location: str | None = None
    birthday: date | None = None
    telegram: str | None = None
    phone: str | None = None
    email: str | None = None  # НЕ EmailStr: LLM может прислать «грязный» email — пусть фронт покажет
    stack: str | None = None  # CSV
    summary: str | None = None
    skill_categories: list[ParsedSkillCategory] | None = None
    experience: list[ParsedExperience] | None = None
    education: list[ParsedEducation] | None = None
    certifications: list[ParsedCertification] | None = None
    languages: list[ParsedLanguage] | None = None


class ParseResumeTextResponse(CamelModel):
    parsed: ParsedCandidate


class ExtractDocResponse(CamelModel):
    """Результат извлечения текста из .doc через antiword."""

    text: str


# ────────────────────────────────────────────────────────────────────────────
# AI-адаптация резюме под вакансию
# ────────────────────────────────────────────────────────────────────────────


class ImproveResumeRequest(CamelModel):
    """Адаптировать резюме кандидата под конкретную вакансию.

    Пара (candidate_id, vacancy_id) валидируется в эндпоинте — оба должны
    существовать и быть доступны текущему пользователю.
    """

    vacancy_id: uuid.UUID


class ImprovedExperienceItem(CamelModel):
    """Адаптированный блок места работы — только переписываемые поля.

    Поле опциональное: модель может улучшить не каждое место работы. Фронт
    мерджит непустые `project`/`achievements` поверх оригинала по индексу.
    """

    project: str | None = None
    achievements: list[str] | None = None


class ImprovedResume(CamelModel):
    """Adapted-под-вакансию подмножество полей кандидата.

    Все поля опциональны. Фронт мерджит непустые значения поверх Candidate
    перед сборкой ResumeModel → DOCX. Никаких новых компаний/должностей AI
    добавить не может — `experience` приходит той же длины, что у кандидата.
    """

    summary: str | None = None
    experience_years: float | None = None
    stack: list[str] | None = None
    skill_categories: list[ParsedSkillCategory] | None = None
    experience: list[ImprovedExperienceItem] | None = None


class ImproveResumeResponse(CamelModel):
    improvement: ImprovedResume
