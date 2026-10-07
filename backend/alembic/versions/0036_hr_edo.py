"""Кадровый ЭДО (Этап 1) + роль «Бухгалтер»

Revision ID: 0036_hr_edo
Revises: 0035_screening_last_seen
Create Date: 2026-09-29

См. docs/plan-hr-edo.md и docs/plan-hr-edo-roadmap.md (задача 1.1).

* роль `accountant` в `user_role` — бухгалтер ведёт кадровый ЭДО;
* таблицы `hr_employees`, `hr_signing_keys`, `hr_documents`, `hr_signatures`,
  `hr_sign_challenges`, `hr_doc_events`, `hr_access_tokens`, `hr_doc_counters`;
* триггер, запрещающий UPDATE / DELETE / TRUNCATE на `hr_doc_events`;
* новые значения enum: `file_entity_type.hr_document`,
  `notification_kind.hr_document`, `notification_entity_type.hr_document`.

Строки матрицы прав `hr_edo.*` и ключ `accountant` в существующих строках
доливает `permissions.service._sync_missing_defaults` при первом чтении
матрицы — миграция данные матрицы не трогает.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0036_hr_edo"
down_revision: str | Sequence[str] | None = "0035_screening_last_seen"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMPLOYEE_STATUSES = ("active", "dismissed")
EDO_STATUSES = ("not_invited", "notified", "consent_signed", "active", "refused", "key_revoked")
DOC_STATUSES = (
    "draft", "frozen", "awaiting_employer", "sent", "viewed",
    "signed", "rejected", "expired", "cancelled", "archived_paper",
)
SIGNER_ROLES = ("employer", "employee")
SIG_TYPES = ("unep_lg", "gosklyuch", "ukep", "paper")
CHALLENGE_PURPOSES = ("portal_login", "key_issue", "sign")
CHALLENGE_STATUSES = ("pending", "confirmed", "locked", "expired", "superseded")
EVENT_KINDS = (
    "created", "frozen", "employer_signed", "sent", "notified", "link_opened",
    "portal_login", "viewed", "viewed_to_end", "otp_sent", "otp_delivered",
    "otp_failed", "signed", "rejected", "downloaded", "exported",
    "consent_registered", "key_issued", "key_revoked", "phone_changed",
    "cancelled", "employee_created", "edo_refused", "expired", "paper_signed",
    "employee_updated", "integrity_failed",
)

_ENUMS = {
    "hr_employee_status": EMPLOYEE_STATUSES,
    "hr_edo_status": EDO_STATUSES,
    "hr_doc_status": DOC_STATUSES,
    "hr_signer_role": SIGNER_ROLES,
    "hr_sig_type": SIG_TYPES,
    "hr_challenge_purpose": CHALLENGE_PURPOSES,
    "hr_challenge_status": CHALLENGE_STATUSES,
    "hr_event_kind": EVENT_KINDS,
}


def _enum(name: str) -> postgresql.ENUM:
    return postgresql.ENUM(*_ENUMS[name], name=name, create_type=False)


def _uuid_pk() -> sa.Column:
    return sa.Column(
        "id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")
    )


def _fk(name: str, target: str, ondelete: str, *, nullable: bool = True, index: bool = False) -> sa.Column:
    return sa.Column(
        name,
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey(target, ondelete=ondelete),
        nullable=nullable,
        index=index,
    )


def _ts(name: str, *, nullable: bool = True, default_now: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=sa.text("now()") if default_now else None,
    )


def upgrade() -> None:
    # ADD VALUE нельзя использовать в той же транзакции — autocommit-блок (как 0033).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'accountant'")
        op.execute("ALTER TYPE file_entity_type ADD VALUE IF NOT EXISTS 'hr_document'")
        op.execute("ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'hr_document'")
        op.execute("ALTER TYPE notification_entity_type ADD VALUE IF NOT EXISTS 'hr_document'")

    bind = op.get_bind()
    for name, values in _ENUMS.items():
        postgresql.ENUM(*values, name=name, create_type=True).create(bind, checkfirst=True)

    op.create_table(
        "hr_employees",
        _uuid_pk(),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True, unique=True,
        ),
        _fk("candidate_id", "candidates.id", "SET NULL", index=True),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("position", sa.String(255), nullable=False, server_default=""),
        sa.Column(
            "employment_type",
            postgresql.ENUM("ИП", "СМЗ", "ТК РФ", name="employment_type", create_type=False),
            nullable=False,
            server_default="ТК РФ",
        ),
        sa.Column("phone_e164", sa.String(20), nullable=True),
        _ts("phone_verified_at"),
        sa.Column("email", postgresql.CITEXT(), nullable=True),
        sa.Column("hired_at", sa.Date(), nullable=True),
        sa.Column("dismissed_at", sa.Date(), nullable=True),
        sa.Column("status", _enum("hr_employee_status"), nullable=False, server_default="active"),
        sa.Column("edo_status", _enum("hr_edo_status"), nullable=False, server_default="not_invited"),
        sa.Column("edo_consent_doc_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("active_key_id", postgresql.UUID(as_uuid=True), nullable=True),
        _fk("created_by", "users.id", "SET NULL"),
        _ts("created_at", nullable=False, default_now=True),
        _ts("updated_at", nullable=False, default_now=True),
    )
    op.create_index("ix_hr_employees_edo_status", "hr_employees", ["edo_status"])

    op.create_table(
        "hr_documents",
        _uuid_pk(),
        _fk("employee_id", "hr_employees.id", "RESTRICT", nullable=False, index=True),
        sa.Column("type_code", sa.String(64), nullable=False, index=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("number", sa.String(32), nullable=True, unique=True),
        sa.Column("doc_date", sa.Date(), nullable=False),
        sa.Column("status", _enum("hr_doc_status"), nullable=False, server_default="draft", index=True),
        sa.Column("fields", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        _fk("source_file_id", "files.id", "RESTRICT"),
        sa.Column("content_sha256", sa.String(64), nullable=True),
        sa.Column("content_streebog256", sa.String(64), nullable=True),
        _ts("frozen_at"),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
        _ts("due_at"),
        _ts("sent_at"),
        _ts("viewed_at"),
        _ts("signed_at"),
        _ts("last_reminded_at"),
        _fk("created_by", "users.id", "SET NULL"),
        _fk("stamped_file_id", "files.id", "SET NULL"),
        _fk("replaces_id", "hr_documents.id", "SET NULL"),
        sa.Column("cancel_reason", sa.String(1024), nullable=True),
        sa.Column("reject_reason", sa.String(1024), nullable=True),
        _ts("created_at", nullable=False, default_now=True),
        _ts("updated_at", nullable=False, default_now=True),
    )

    op.create_table(
        "hr_signing_keys",
        _uuid_pk(),
        _fk("employee_id", "hr_employees.id", "RESTRICT", nullable=False, index=True),
        sa.Column("crypto_key_id", sa.String(128), nullable=False, unique=True),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("algorithm", sa.String(64), nullable=False),
        sa.Column("phone_e164_at_issue", sa.String(20), nullable=False),
        _ts("issued_at", nullable=False),
        _fk("issued_by_consent_doc_id", "hr_documents.id", "RESTRICT"),
        _ts("revoked_at"),
        sa.Column("revoke_reason", sa.String(512), nullable=True),
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_foreign_key(
        "fk_hr_employees_consent_doc", "hr_employees", "hr_documents",
        ["edo_consent_doc_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_hr_employees_active_key", "hr_employees", "hr_signing_keys",
        ["active_key_id"], ["id"], ondelete="SET NULL",
    )

    op.create_table(
        "hr_sign_challenges",
        _uuid_pk(),
        _fk("employee_id", "hr_employees.id", "RESTRICT", nullable=False, index=True),
        sa.Column("purpose", _enum("hr_challenge_purpose"), nullable=False),
        sa.Column(
            "document_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), nullable=False,
            server_default=sa.text("'{}'::uuid[]"),
        ),
        sa.Column("digests_hash", sa.String(64), nullable=True),
        sa.Column("code_hmac", sa.String(64), nullable=False),
        sa.Column("phone_masked", sa.String(32), nullable=False),
        _ts("expires_at", nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("status", _enum("hr_challenge_status"), nullable=False, server_default="pending"),
        sa.Column("sms_provider_id", sa.String(128), nullable=True),
        sa.Column("sms_delivery_status", sa.String(32), nullable=True),
        sa.Column("created_ip", postgresql.INET(), nullable=True),
        _ts("created_at", nullable=False),
        _ts("confirmed_at"),
    )

    op.create_table(
        "hr_signatures",
        _uuid_pk(),
        _fk("document_id", "hr_documents.id", "RESTRICT", nullable=False, index=True),
        sa.Column("signer_role", _enum("hr_signer_role"), nullable=False),
        _fk("employee_id", "hr_employees.id", "RESTRICT"),
        _fk("user_id", "users.id", "SET NULL"),
        sa.Column("signer_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("sig_type", _enum("hr_sig_type"), nullable=False),
        _fk("signing_key_id", "hr_signing_keys.id", "RESTRICT"),
        sa.Column("signed_digest", sa.String(64), nullable=True),
        _fk("signature_file_id", "files.id", "RESTRICT"),
        sa.Column("cert_subject", sa.String(1024), nullable=True),
        sa.Column("cert_issuer", sa.String(1024), nullable=True),
        sa.Column("cert_serial", sa.String(128), nullable=True),
        _ts("cert_valid_from"),
        _ts("cert_valid_to"),
        _fk("poa_file_id", "files.id", "RESTRICT"),
        _ts("tsp_time"),
        sa.Column("verification", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        _fk("challenge_id", "hr_sign_challenges.id", "RESTRICT"),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        _ts("signed_at", nullable=False),
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "hr_doc_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        _fk("document_id", "hr_documents.id", "RESTRICT", index=True),
        _fk("employee_id", "hr_employees.id", "RESTRICT", index=True),
        sa.Column("kind", _enum("hr_event_kind"), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        # Без FK на users: SET NULL был бы UPDATE строки протокола.
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_employee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("ua", sa.String(512), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("prev_hash", sa.String(64), nullable=False),
        sa.Column("hash", sa.String(64), nullable=False, unique=True),
        _ts("created_at", nullable=False),
    )

    op.create_table(
        "hr_access_tokens",
        _uuid_pk(),
        _fk("employee_id", "hr_employees.id", "RESTRICT", nullable=False, index=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True, index=True),
        _ts("expires_at", nullable=False),
        _ts("revoked_at"),
        _ts("last_used_at"),
        _fk("created_by", "users.id", "SET NULL"),
        _ts("created_at", nullable=False, default_now=True),
    )

    op.create_table(
        "hr_doc_counters",
        sa.Column("prefix", sa.String(16), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("prefix", "year", name="pk_hr_doc_counters"),
    )

    # Неизменяемость протокола. Тот же SQL — в app/modules/hr_edo/models.py.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION hr_doc_events_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'hr_doc_events is append-only: % is forbidden', TG_OP
                USING ERRCODE = 'insufficient_privilege';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_hr_doc_events_immutable
        BEFORE UPDATE OR DELETE ON hr_doc_events
        FOR EACH ROW EXECUTE FUNCTION hr_doc_events_immutable()
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_hr_doc_events_no_truncate
        BEFORE TRUNCATE ON hr_doc_events
        FOR EACH STATEMENT EXECUTE FUNCTION hr_doc_events_immutable()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_hr_doc_events_no_truncate ON hr_doc_events")
    op.execute("DROP TRIGGER IF EXISTS trg_hr_doc_events_immutable ON hr_doc_events")
    op.execute("DROP FUNCTION IF EXISTS hr_doc_events_immutable()")
    op.drop_table("hr_doc_counters")
    op.drop_table("hr_access_tokens")
    op.drop_table("hr_doc_events")
    op.drop_table("hr_signatures")
    op.drop_table("hr_sign_challenges")
    op.drop_constraint("fk_hr_employees_active_key", "hr_employees", type_="foreignkey")
    op.drop_constraint("fk_hr_employees_consent_doc", "hr_employees", type_="foreignkey")
    op.drop_table("hr_signing_keys")
    op.drop_table("hr_documents")
    op.drop_index("ix_hr_employees_edo_status", table_name="hr_employees")
    op.drop_table("hr_employees")
    bind = op.get_bind()
    for name in reversed(list(_ENUMS)):
        postgresql.ENUM(name=name).drop(bind, checkfirst=True)
    # Значения user_role / file_entity_type / notification_* из ENUM не удаляются
    # (Postgres этого не умеет) — как и в 0033. Пользователей с ролью accountant
    # перед даунгрейдом нужно перевести в другую роль вручную.
