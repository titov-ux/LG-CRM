"""SQLAlchemy-модели кадрового ЭДО (миграция 0036_hr_edo).

* `hr_employees` — реестр подписантов. Не равен `users`: аутстафф-специалисты
  подписывают через публичный портал без аккаунта CRM.
* `hr_signing_keys` — реестр ключей УНЭП ЛГ, только публичная часть. Закрытые
  ключи живут в crypto-service (КриптоПро JCP), бэкенд к ним доступа не имеет.
* `hr_documents` — документы; после `frozen_at` содержимое неизменно.
* `hr_signatures` — подписи (работодателя и сотрудника).
* `hr_sign_challenges` — SMS-коды; код хранится только как HMAC.
* `hr_doc_events` — неизменяемый протокол с хеш-цепочкой; триггер Postgres
  запрещает UPDATE/DELETE/TRUNCATE (ставится и миграцией, и в `create_all`
  через DDL-события ниже — тесты создают схему без alembic).
* `hr_access_tokens` — ссылки на портал подписания (в БД только SHA-256).
* `hr_doc_counters` — сквозная нумерация по префиксу типа и году.

Все FK на `users.id` — `SET NULL` + nullable (паттерн 0011). В протоколе FK на
users нет вовсе: `SET NULL` означал бы UPDATE строки протокола, а его запрещает
триггер. Автор события хранится снимком (`actor_user_id` + `actor_name`).
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    DDL,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Identity,
    Integer,
    LargeBinary,
    PrimaryKeyConstraint,
    String,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampsMixin
from app.modules.candidates.models import EmploymentType


def _enum_values(e: type[enum.Enum]) -> list[str]:
    return [m.value for m in e]


class HrEmployeeStatus(str, enum.Enum):
    active = "active"
    dismissed = "dismissed"


class EdoStatus(str, enum.Enum):
    """Жизненный цикл сотрудника в КЭДО (plan-hr-edo.md)."""

    not_invited = "not_invited"
    # Уведомлён о переходе / получил пакет согласия.
    notified = "notified"
    # Подписанный пакет согласия (+ соглашение об УНЭП) зарегистрирован.
    consent_signed = "consent_signed"
    # Ключ УНЭП ЛГ выпущен — может подписывать по SMS.
    active = "active"
    # Отказ от КЭДО — бумажный контур без санкций (ч. 8–9 ст. 22.2 ТК).
    refused = "refused"
    # Ключ отозван (компрометация, смена телефона) — нужен новый ключ.
    key_revoked = "key_revoked"


class HrDocStatus(str, enum.Enum):
    draft = "draft"
    frozen = "frozen"
    awaiting_employer = "awaiting_employer"
    sent = "sent"
    viewed = "viewed"
    signed = "signed"
    rejected = "rejected"
    expired = "expired"
    cancelled = "cancelled"
    archived_paper = "archived_paper"


class SignerRole(str, enum.Enum):
    employer = "employer"
    employee = "employee"


class SigType(str, enum.Enum):
    unep_lg = "unep_lg"
    gosklyuch = "gosklyuch"
    ukep = "ukep"
    paper = "paper"


class ChallengePurpose(str, enum.Enum):
    portal_login = "portal_login"
    key_issue = "key_issue"
    sign = "sign"


class ChallengeStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    locked = "locked"
    expired = "expired"
    superseded = "superseded"


class HrEventKind(str, enum.Enum):
    created = "created"
    frozen = "frozen"
    employer_signed = "employer_signed"
    sent = "sent"
    notified = "notified"
    link_opened = "link_opened"
    portal_login = "portal_login"
    viewed = "viewed"
    viewed_to_end = "viewed_to_end"
    otp_sent = "otp_sent"
    otp_delivered = "otp_delivered"
    otp_failed = "otp_failed"
    signed = "signed"
    rejected = "rejected"
    downloaded = "downloaded"
    exported = "exported"
    consent_registered = "consent_registered"
    key_issued = "key_issued"
    key_revoked = "key_revoked"
    phone_changed = "phone_changed"
    cancelled = "cancelled"
    # Дополнительно к плану: учётные события реестра и сроков.
    employee_created = "employee_created"
    edo_refused = "edo_refused"
    expired = "expired"
    paper_signed = "paper_signed"
    employee_updated = "employee_updated"
    integrity_failed = "integrity_failed"


class HrEmployee(Base, TimestampsMixin):
    __tablename__ = "hr_employees"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    # Внутренний сотрудник видит свои документы в CRM («Мои документы»).
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("candidates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    employment_type: Mapped[EmploymentType] = mapped_column(
        Enum(
            EmploymentType,
            name="employment_type",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
        default=EmploymentType.tk_rf,
    )
    # E.164 (`+79991234567`). Номер фиксируется в соглашении об УНЭП; смена —
    # отдельной процедурой (POST /employees/{id}/phone), не через PATCH.
    phone_e164: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phone_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    email: Mapped[str | None] = mapped_column(CITEXT(), nullable=True)
    hired_at: Mapped[date | None] = mapped_column(Date(), nullable=True)
    dismissed_at: Mapped[date | None] = mapped_column(Date(), nullable=True)
    status: Mapped[HrEmployeeStatus] = mapped_column(
        Enum(HrEmployeeStatus, name="hr_employee_status", values_callable=_enum_values),
        nullable=False,
        default=HrEmployeeStatus.active,
    )
    edo_status: Mapped[EdoStatus] = mapped_column(
        Enum(EdoStatus, name="hr_edo_status", values_callable=_enum_values),
        nullable=False,
        default=EdoStatus.not_invited,
        index=True,
    )
    edo_consent_doc_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("hr_documents.id", ondelete="SET NULL", use_alter=True, name="fk_hr_employees_consent_doc"),
        nullable=True,
    )
    active_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("hr_signing_keys.id", ondelete="SET NULL", use_alter=True, name="fk_hr_employees_active_key"),
        nullable=True,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class HrSigningKey(Base):
    __tablename__ = "hr_signing_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Идентификатор ключа в хранилище crypto-service.
    crypto_key_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary(), nullable=False)
    # Стрибог-256 от открытого ключа (hex) — показывается сотруднику.
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    algorithm: Mapped[str] = mapped_column(String(64), nullable=False)
    phone_e164_at_issue: Mapped[str] = mapped_column(String(20), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    issued_by_consent_doc_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_documents.id", ondelete="RESTRICT"), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # true — ключ выпущен no-op crypto-service (dev): «тестовая подпись».
    is_test: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class HrDocument(Base, TimestampsMixin):
    __tablename__ = "hr_documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    type_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    number: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)
    doc_date: Mapped[date] = mapped_column(Date(), nullable=False)
    status: Mapped[HrDocStatus] = mapped_column(
        Enum(HrDocStatus, name="hr_doc_status", values_callable=_enum_values),
        nullable=False,
        default=HrDocStatus.draft,
        index=True,
    )
    # Значения полей шаблона (для черновика и повторного рендера предпросмотра).
    fields: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    source_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id", ondelete="RESTRICT"), nullable=True
    )
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_streebog256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # PDF с листом подписания. Исходный PDF не меняется никогда.
    stamped_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    replaces_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_documents.id", ondelete="SET NULL"), nullable=True
    )
    cancel_reason: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(1024), nullable=True)


class HrSignature(Base):
    __tablename__ = "hr_signatures"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_documents.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    signer_role: Mapped[SignerRole] = mapped_column(
        Enum(SignerRole, name="hr_signer_role", values_callable=_enum_values), nullable=False
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_employees.id", ondelete="RESTRICT"), nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    signer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    sig_type: Mapped[SigType] = mapped_column(
        Enum(SigType, name="hr_sig_type", values_callable=_enum_values), nullable=False
    )
    signing_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_signing_keys.id", ondelete="RESTRICT"), nullable=True
    )
    # Хеш, который подписан (Стрибог-256 hex исходного PDF).
    signed_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # `.sig` CAdES или скан бумажного оригинала.
    signature_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id", ondelete="RESTRICT"), nullable=True
    )
    cert_subject: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    cert_issuer: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    cert_serial: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cert_valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cert_valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    poa_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id", ondelete="RESTRICT"), nullable=True
    )
    tsp_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    challenge_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_sign_challenges.id", ondelete="RESTRICT"), nullable=True
    )
    ip: Mapped[str | None] = mapped_column(INET(), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_test: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class HrSignChallenge(Base):
    __tablename__ = "hr_sign_challenges"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    purpose: Mapped[ChallengePurpose] = mapped_column(
        Enum(ChallengePurpose, name="hr_challenge_purpose", values_callable=_enum_values),
        nullable=False,
    )
    document_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, server_default=text("'{}'::uuid[]")
    )
    # SHA-256 от отсортированных хешей документов: код действует только для
    # своего набора документов в их замороженном виде.
    digests_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    code_hmac: Mapped[str] = mapped_column(String(64), nullable=False)
    phone_masked: Mapped[str] = mapped_column(String(32), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    status: Mapped[ChallengeStatus] = mapped_column(
        Enum(ChallengeStatus, name="hr_challenge_status", values_callable=_enum_values),
        nullable=False,
        default=ChallengeStatus.pending,
    )
    sms_provider_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sms_delivery_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_ip: Mapped[str | None] = mapped_column(INET(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HrDocEvent(Base):
    __tablename__ = "hr_doc_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_documents.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_employees.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    kind: Mapped[HrEventKind] = mapped_column(
        Enum(HrEventKind, name="hr_event_kind", values_callable=_enum_values), nullable=False
    )
    # user | employee | system
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_employee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ua: Mapped[str | None] = mapped_column(String(512), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class HrAccessToken(Base):
    __tablename__ = "hr_access_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hr_employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # SHA-256 hex сырого токена (как в password_invites).
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Новая ссылка отзывает предыдущие — «использованный» токен больше не пускает.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class HrDocCounter(Base):
    __tablename__ = "hr_doc_counters"
    __table_args__ = (PrimaryKeyConstraint("prefix", "year", name="pk_hr_doc_counters"),)

    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


# ── Неизменяемость протокола ────────────────────────────────────────────────
# Тот же SQL ставит миграция 0036_hr_edo. Здесь — для `Base.metadata.create_all`
# (тестовая схема собирается без alembic).
IMMUTABLE_EVENTS_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION hr_doc_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'hr_doc_events is append-only: % is forbidden', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql
"""
IMMUTABLE_EVENTS_ROW_TRIGGER_SQL = """
CREATE TRIGGER trg_hr_doc_events_immutable
BEFORE UPDATE OR DELETE ON hr_doc_events
FOR EACH ROW EXECUTE FUNCTION hr_doc_events_immutable()
"""
IMMUTABLE_EVENTS_TRUNCATE_TRIGGER_SQL = """
CREATE TRIGGER trg_hr_doc_events_no_truncate
BEFORE TRUNCATE ON hr_doc_events
FOR EACH STATEMENT EXECUTE FUNCTION hr_doc_events_immutable()
"""

_events_table = HrDocEvent.__table__
# DDL() форматирует строку через `%` — экранируем плейсхолдер RAISE.
event.listen(_events_table, "after_create", DDL(IMMUTABLE_EVENTS_FUNCTION_SQL.replace("%", "%%")))  # type: ignore[no-untyped-call]
event.listen(_events_table, "after_create", DDL(IMMUTABLE_EVENTS_ROW_TRIGGER_SQL))  # type: ignore[no-untyped-call]
event.listen(_events_table, "after_create", DDL(IMMUTABLE_EVENTS_TRUNCATE_TRIGGER_SQL))  # type: ignore[no-untyped-call]
