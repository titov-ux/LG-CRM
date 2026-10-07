"""Сборка DTO кадрового ЭДО из ORM (пакетные подгрузки без N+1)."""
from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.sms import mask_phone
from app.modules.hr_edo.doc_types import DOC_TYPES, DocType, get_doc_type
from app.modules.hr_edo.models import (
    HrDocStatus,
    HrDocument,
    HrEmployee,
    HrSignature,
    HrSignChallenge,
    HrSigningKey,
    SigType,
)
from app.modules.hr_edo.schemas import (
    DocTypeDto,
    DocTypeFieldDto,
    EmployeeSelfDto,
    HrDocumentDto,
    HrEmployeeDto,
    HrSignatureDto,
    PortalDocumentDto,
    SigningKeyDto,
)
from app.modules.users.models import User

# Документ «ждёт» сотрудника: отправлен и ещё не подписан/не отклонён.
PENDING_FOR_EMPLOYEE = (HrDocStatus.sent, HrDocStatus.viewed)


def doc_type_dto(t: DocType) -> DocTypeDto:
    return DocTypeDto(
        code=t.code,
        title=t.title,
        number_prefix=t.number_prefix,
        contour=t.contour,
        employee_action=t.employee_action,
        employee_sig=list(t.employee_sig),
        employer_sig=t.employer_sig,
        sign_order=t.sign_order,
        retention_years=t.retention_years,
        upload_only=t.is_upload_only,
        paper_only=t.paper_only,
        strict_group=t.strict_group,
        stage=t.stage,
        description=t.description,
        fields=[
            DocTypeFieldDto(
                key=f.key,
                label=f.label,
                type=f.type,
                required=f.required,
                default_from=f.default_from,
                default=f.default,
                options=list(f.options),
                placeholder=f.placeholder,
                hint=f.hint,
            )
            for f in t.fields
        ],
    )


def all_doc_types() -> list[DocTypeDto]:
    return [doc_type_dto(t) for t in DOC_TYPES]


def key_dto(key: HrSigningKey | None) -> SigningKeyDto | None:
    if key is None:
        return None
    return SigningKeyDto(
        id=key.id,
        fingerprint=key.fingerprint,
        algorithm=key.algorithm,
        issued_at=key.issued_at,
        revoked_at=key.revoked_at,
        revoke_reason=key.revoke_reason,
        phone_masked=mask_phone(key.phone_e164_at_issue),
        is_test=key.is_test,
    )


async def _pending_counts(db: AsyncSession, employee_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not employee_ids:
        return {}
    rows = await db.execute(
        select(HrDocument.employee_id, func.count(HrDocument.id))
        .where(HrDocument.employee_id.in_(employee_ids), HrDocument.status.in_(PENDING_FOR_EMPLOYEE))
        .group_by(HrDocument.employee_id)
    )
    return {eid: int(cnt) for eid, cnt in rows.all()}


async def employees_dto(db: AsyncSession, employees: Sequence[HrEmployee]) -> list[HrEmployeeDto]:
    ids = [e.id for e in employees]
    key_ids = [e.active_key_id for e in employees if e.active_key_id]
    user_ids = [e.user_id for e in employees if e.user_id]
    keys: dict[uuid.UUID, HrSigningKey] = {}
    if key_ids:
        keys = {k.id: k for k in (await db.execute(select(HrSigningKey).where(HrSigningKey.id.in_(key_ids)))).scalars()}
    users: dict[uuid.UUID, str] = {}
    if user_ids:
        users = dict((await db.execute(select(User.id, User.full_name).where(User.id.in_(user_ids)))).tuples().all())
    pending = await _pending_counts(db, ids)
    return [
        HrEmployeeDto(
            id=e.id,
            user_id=e.user_id,
            user_name=users.get(e.user_id) if e.user_id else None,
            candidate_id=e.candidate_id,
            full_name=e.full_name,
            position=e.position,
            employment_type=e.employment_type,
            phone=e.phone_e164,
            phone_masked=mask_phone(e.phone_e164) if e.phone_e164 else None,
            phone_verified_at=e.phone_verified_at,
            email=e.email,
            hired_at=e.hired_at,
            dismissed_at=e.dismissed_at,
            status=e.status,
            edo_status=e.edo_status,
            edo_consent_doc_id=e.edo_consent_doc_id,
            active_key=key_dto(keys.get(e.active_key_id)) if e.active_key_id else None,
            pending_documents=pending.get(e.id, 0),
            created_at=e.created_at,
            updated_at=e.updated_at,
        )
        for e in employees
    ]


async def employee_dto(db: AsyncSession, employee: HrEmployee) -> HrEmployeeDto:
    return (await employees_dto(db, [employee]))[0]


async def employee_self_dto(db: AsyncSession, employee: HrEmployee) -> EmployeeSelfDto:
    key = await db.get(HrSigningKey, employee.active_key_id) if employee.active_key_id else None
    pending = (await _pending_counts(db, [employee.id])).get(employee.id, 0)
    return EmployeeSelfDto(
        id=employee.id,
        full_name=employee.full_name,
        position=employee.position,
        edo_status=employee.edo_status,
        phone_masked=mask_phone(employee.phone_e164) if employee.phone_e164 else None,
        email=employee.email,
        key=key_dto(key),
        company_name=get_settings().hr_edo_company_name,
        pending_count=pending,
    )


async def _signatures_by_doc(
    db: AsyncSession, doc_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[HrSignatureDto]]:
    out: dict[uuid.UUID, list[HrSignatureDto]] = defaultdict(list)
    if not doc_ids:
        return out
    sigs = list(
        (
            await db.execute(
                select(HrSignature).where(HrSignature.document_id.in_(doc_ids)).order_by(HrSignature.signed_at)
            )
        ).scalars()
    )
    key_ids = {s.signing_key_id for s in sigs if s.signing_key_id}
    ch_ids = {s.challenge_id for s in sigs if s.challenge_id}
    keys: dict[uuid.UUID, str] = {}
    if key_ids:
        keys = dict(
            (await db.execute(select(HrSigningKey.id, HrSigningKey.fingerprint).where(HrSigningKey.id.in_(key_ids))))
            .tuples()
            .all()
        )
    phones: dict[uuid.UUID, str] = {}
    if ch_ids:
        phones = dict(
            (
                await db.execute(
                    select(HrSignChallenge.id, HrSignChallenge.phone_masked).where(HrSignChallenge.id.in_(ch_ids))
                )
            )
            .tuples()
            .all()
        )
    for s in sigs:
        out[s.document_id].append(
            HrSignatureDto(
                id=s.id,
                signer_role=s.signer_role,
                signer_name=s.signer_name,
                sig_type=s.sig_type,
                signed_at=s.signed_at,
                tsp_time=s.tsp_time,
                fingerprint=keys.get(s.signing_key_id) if s.signing_key_id else None,
                phone_masked=phones.get(s.challenge_id) if s.challenge_id else None,
                cert_subject=s.cert_subject,
                cert_issuer=s.cert_issuer,
                cert_serial=s.cert_serial,
                has_file=s.signature_file_id is not None,
                is_test=s.is_test,
                verification=dict(s.verification or {}),
            )
        )
    return out


async def documents_dto(db: AsyncSession, docs: Sequence[HrDocument]) -> list[HrDocumentDto]:
    emp_ids = {d.employee_id for d in docs}
    user_ids = {d.created_by for d in docs if d.created_by}
    names: dict[uuid.UUID, str] = {}
    if emp_ids:
        names = dict(
            (await db.execute(select(HrEmployee.id, HrEmployee.full_name).where(HrEmployee.id.in_(emp_ids))))
            .tuples()
            .all()
        )
    users: dict[uuid.UUID, str] = {}
    if user_ids:
        users = dict((await db.execute(select(User.id, User.full_name).where(User.id.in_(user_ids)))).tuples().all())
    sigs = await _signatures_by_doc(db, [d.id for d in docs])
    return [
        HrDocumentDto(
            id=d.id,
            employee_id=d.employee_id,
            employee_name=names.get(d.employee_id, ""),
            type_code=d.type_code,
            title=d.title,
            number=d.number,
            doc_date=d.doc_date,
            status=d.status,
            fields=dict(d.fields or {}),
            content_sha256=d.content_sha256,
            content_streebog256=d.content_streebog256,
            frozen_at=d.frozen_at,
            sent_at=d.sent_at,
            viewed_at=d.viewed_at,
            signed_at=d.signed_at,
            due_at=d.due_at,
            batch_id=d.batch_id,
            has_source=d.source_file_id is not None,
            has_stamped=d.stamped_file_id is not None,
            cancel_reason=d.cancel_reason,
            reject_reason=d.reject_reason,
            created_by=d.created_by,
            created_by_name=users.get(d.created_by) if d.created_by else None,
            created_at=d.created_at,
            updated_at=d.updated_at,
            signatures=sigs.get(d.id, []),
        )
        for d in docs
    ]


async def document_dto(db: AsyncSession, doc: HrDocument) -> HrDocumentDto:
    return (await documents_dto(db, [doc]))[0]


def sign_method(doc: HrDocument, t: DocType | None) -> str:
    if t is None or not t.employee_signs:
        return "none"
    return "unep_lg" if t.allows_unep_lg else "external"


def employee_can_sign(doc: HrDocument, employee: HrEmployee, t: DocType | None) -> bool:
    from app.modules.hr_edo.models import EdoStatus

    return (
        t is not None
        and t.allows_unep_lg
        and t.employee_signs
        and not t.paper_only
        and doc.status in PENDING_FOR_EMPLOYEE
        and employee.edo_status == EdoStatus.active
        and employee.active_key_id is not None
    )


async def portal_documents_dto(
    db: AsyncSession, employee: HrEmployee, docs: Sequence[HrDocument]
) -> list[PortalDocumentDto]:
    sigs = await _signatures_by_doc(db, [d.id for d in docs])
    out: list[PortalDocumentDto] = []
    for d in docs:
        t = get_doc_type(d.type_code)
        out.append(
            PortalDocumentDto(
                id=d.id,
                type_code=d.type_code,
                title=d.title,
                number=d.number,
                doc_date=d.doc_date,
                status=d.status,
                employee_action=t.employee_action if t else "none",
                sign_method=sign_method(d, t),
                can_sign=employee_can_sign(d, employee, t),
                due_at=d.due_at,
                sent_at=d.sent_at,
                signed_at=d.signed_at,
                viewed_at=d.viewed_at,
                content_streebog256=d.content_streebog256,
                # Сотруднику IP и детали проверки чужих подписей не нужны.
                signatures=[s.model_copy(update={"verification": {}}) for s in sigs.get(d.id, [])],
            )
        )
    return out


SIG_TYPE_LABEL = {
    SigType.unep_lg: "Усиленная неквалифицированная ЭП ЛГ Интеграция",
    SigType.gosklyuch: "УНЭП Госключ",
    SigType.ukep: "Усиленная квалифицированная ЭП",
    SigType.paper: "Собственноручная подпись (скан бумажного оригинала)",
}
