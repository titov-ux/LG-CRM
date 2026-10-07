"""DTO кадрового ЭДО (контракт — docs/openapi.yaml, тег hr-edo)."""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Any

from pydantic import Field, field_validator

from app.core.schemas import CamelModel
from app.modules.candidates.models import EmploymentType
from app.modules.hr_edo.models import (
    EdoStatus,
    HrDocStatus,
    HrEmployeeStatus,
    SignerRole,
    SigType,
)


def normalize_phone(value: str | None) -> str | None:
    """`8 (999) 123-45-67` / `+7 999 1234567` → `+79991234567`."""
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits[0] == "8":
        digits = "7" + digits[1:]
    elif len(digits) == 10 and digits[0] == "9":
        digits = "7" + digits
    if not 11 <= len(digits) <= 15:
        raise ValueError("Некорректный номер телефона")
    return f"+{digits}"


# ── Справочник типов ────────────────────────────────────────────────────────


class DocTypeFieldDto(CamelModel):
    key: str
    label: str
    type: str
    required: bool
    default_from: str | None = None
    default: str | None = None
    options: list[str] = Field(default_factory=list)
    placeholder: str | None = None
    hint: str | None = None


class DocTypeDto(CamelModel):
    code: str
    title: str
    number_prefix: str
    contour: str
    employee_action: str
    employee_sig: list[str]
    employer_sig: str
    sign_order: str
    retention_years: int
    upload_only: bool
    paper_only: bool
    strict_group: bool
    stage: int
    description: str
    fields: list[DocTypeFieldDto]


# ── Сотрудники ──────────────────────────────────────────────────────────────


class SigningKeyDto(CamelModel):
    id: uuid.UUID
    fingerprint: str
    algorithm: str
    issued_at: datetime
    revoked_at: datetime | None = None
    revoke_reason: str | None = None
    phone_masked: str
    is_test: bool


class HrEmployeeDto(CamelModel):
    id: uuid.UUID
    user_id: uuid.UUID | None = None
    user_name: str | None = None
    candidate_id: uuid.UUID | None = None
    full_name: str
    position: str
    employment_type: EmploymentType
    phone: str | None = None
    phone_masked: str | None = None
    phone_verified_at: datetime | None = None
    email: str | None = None
    hired_at: date | None = None
    dismissed_at: date | None = None
    status: HrEmployeeStatus
    edo_status: EdoStatus
    edo_consent_doc_id: uuid.UUID | None = None
    active_key: SigningKeyDto | None = None
    pending_documents: int = 0
    created_at: datetime
    updated_at: datetime


class HrEmployeePage(CamelModel):
    items: list[HrEmployeeDto]
    total: int
    page: int
    page_size: int


class _EmployeeFields(CamelModel):
    @field_validator("phone", check_fields=False)
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return normalize_phone(v)

    @field_validator("email", check_fields=False)
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("Некорректный email")
        return v


class CreateEmployeeRequest(_EmployeeFields):
    full_name: str = Field(min_length=2, max_length=255)
    position: str = Field(default="", max_length=255)
    employment_type: EmploymentType = EmploymentType.tk_rf
    phone: str | None = None
    email: str | None = None
    hired_at: date | None = None
    user_id: uuid.UUID | None = None
    candidate_id: uuid.UUID | None = None


class UpdateEmployeeRequest(_EmployeeFields):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    position: str | None = Field(default=None, max_length=255)
    employment_type: EmploymentType | None = None
    phone: str | None = None
    email: str | None = None
    hired_at: date | None = None
    dismissed_at: date | None = None
    status: HrEmployeeStatus | None = None
    user_id: uuid.UUID | None = None


class ChangePhoneRequest(CamelModel):
    phone: str
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        normalized = normalize_phone(v)
        if not normalized:
            raise ValueError("Укажите номер телефона")
        return normalized


class ReasonRequest(CamelModel):
    reason: str = Field(min_length=3, max_length=1000)


class OptionalNoteRequest(CamelModel):
    note: str | None = Field(default=None, max_length=1000)


# ── Документы ───────────────────────────────────────────────────────────────


class HrSignatureDto(CamelModel):
    id: uuid.UUID
    signer_role: SignerRole
    signer_name: str
    sig_type: SigType
    signed_at: datetime
    tsp_time: datetime | None = None
    fingerprint: str | None = None
    phone_masked: str | None = None
    cert_subject: str | None = None
    cert_issuer: str | None = None
    cert_serial: str | None = None
    has_file: bool
    is_test: bool
    verification: dict[str, Any] = Field(default_factory=dict)


class HrDocumentDto(CamelModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str
    type_code: str
    title: str
    number: str | None = None
    doc_date: date
    status: HrDocStatus
    fields: dict[str, Any] = Field(default_factory=dict)
    content_sha256: str | None = None
    content_streebog256: str | None = None
    frozen_at: datetime | None = None
    sent_at: datetime | None = None
    viewed_at: datetime | None = None
    signed_at: datetime | None = None
    due_at: datetime | None = None
    batch_id: uuid.UUID | None = None
    has_source: bool
    has_stamped: bool
    cancel_reason: str | None = None
    reject_reason: str | None = None
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    signatures: list[HrSignatureDto] = Field(default_factory=list)


class HrDocumentPage(CamelModel):
    items: list[HrDocumentDto]
    total: int
    page: int
    page_size: int


class CreateDocumentsRequest(CamelModel):
    type_code: str
    employee_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    fields: dict[str, Any] = Field(default_factory=dict)
    title: str | None = Field(default=None, max_length=500)
    doc_date: date | None = None
    # true — сразу сформировать (заморозить) PDF.
    freeze: bool = False


class UpdateDocumentRequest(CamelModel):
    fields: dict[str, Any] | None = None
    title: str | None = Field(default=None, max_length=500)
    doc_date: date | None = None


class PreviewRequest(CamelModel):
    type_code: str
    employee_id: uuid.UUID | None = None
    fields: dict[str, Any] = Field(default_factory=dict)
    title: str | None = None
    doc_date: date | None = None


class SendDocumentsRequest(CamelModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class SendDocumentsResponse(CamelModel):
    items: list[HrDocumentDto]
    # Ссылки на портал для сотрудников, которым письмо не ушло (нет email/SMTP).
    portal_links: dict[str, str] = Field(default_factory=dict)


class InviteResponse(CamelModel):
    employee: HrEmployeeDto
    document: HrDocumentDto
    email_sent: bool
    portal_url: str | None = None


# ── Протокол ────────────────────────────────────────────────────────────────


class HrEventDto(CamelModel):
    id: int
    document_id: uuid.UUID | None = None
    document_title: str | None = None
    employee_id: uuid.UUID | None = None
    employee_name: str | None = None
    kind: str
    actor_type: str
    actor_name: str
    ip: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    hash: str
    prev_hash: str


class HrEventPage(CamelModel):
    items: list[HrEventDto]
    total: int
    page: int
    page_size: int


class ChainCheckDto(CamelModel):
    ok: bool
    checked: int
    broken_at_id: int | None = None
    reason: str | None = None


# ── SMS-коды, ключ, подписание ──────────────────────────────────────────────


class ChallengeDto(CamelModel):
    challenge_id: uuid.UUID
    phone_masked: str
    expires_at: datetime
    resend_after: int
    document_ids: list[uuid.UUID] = Field(default_factory=list)


class ConfirmCodeRequest(CamelModel):
    code: str = Field(min_length=4, max_length=8)


class ChallengeConfirmRequest(CamelModel):
    challenge_id: uuid.UUID
    code: str = Field(min_length=4, max_length=8)


class CreateSignChallengeRequest(CamelModel):
    document_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class ViewedRequest(CamelModel):
    to_end: bool = False


class SignResultDto(CamelModel):
    signed: list[uuid.UUID]
    documents: list[PortalDocumentDto]


class PortalDocumentDto(CamelModel):
    id: uuid.UUID
    type_code: str
    title: str
    number: str | None = None
    doc_date: date
    status: HrDocStatus
    employee_action: str
    # unep_lg — подписывается здесь кодом из SMS; external — вне системы
    # (пакет согласия: бумага / Госключ / УКЭП); none — только чтение.
    sign_method: str
    can_sign: bool
    due_at: datetime | None = None
    sent_at: datetime | None = None
    signed_at: datetime | None = None
    viewed_at: datetime | None = None
    content_streebog256: str | None = None
    signatures: list[HrSignatureDto] = Field(default_factory=list)


class EmployeeSelfDto(CamelModel):
    """Что сотрудник видит о себе на портале / в «Моих документах»."""

    id: uuid.UUID
    full_name: str
    position: str
    edo_status: EdoStatus
    phone_masked: str | None = None
    email: str | None = None
    key: SigningKeyDto | None = None
    company_name: str
    pending_count: int = 0


class MyOverviewDto(CamelModel):
    employee: EmployeeSelfDto | None = None


class PortalLinkInfoDto(CamelModel):
    employee_name: str
    company_name: str
    phone_masked: str
    expires_at: datetime


class DevSmsDto(CamelModel):
    phone: str
    text: str
    sent_at: datetime


SignResultDto.model_rebuild()
