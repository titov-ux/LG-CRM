"""Бизнес-логика кадрового ЭДО: реестр сотрудников, согласие, документы.

Подписание сотрудником и выпуск ключа — в `signing.py` / `keys.py`, портал —
в `portal.py`. Все действия пишут события в неизменяемый протокол
(`evidence.record_event`) в той же транзакции, что и само действие.

Права проверяются на уровне эндпоинтов (`require_action`); сюда приходит уже
авторизованный кадровик (`hr_edo:manage`) или директор (`hr_edo:sign_employer`).
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import status
from pydantic.alias_generators import to_camel
from sqlalchemy import Select, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.integrations.crypto_service import CryptoServiceError, crypto_service
from app.integrations.sms import mask_phone
from app.modules.candidates.models import Candidate, CandidateStatus, EmploymentType
from app.modules.hr_edo import notify, rendering, storage
from app.modules.hr_edo.doc_types import CONSENT_PACKAGE, DocType, get_doc_type
from app.modules.hr_edo.dto import SIG_TYPE_LABEL
from app.modules.hr_edo.evidence import Actor, record_event
from app.modules.hr_edo.models import (
    EdoStatus,
    HrDocCounter,
    HrDocEvent,
    HrDocStatus,
    HrDocument,
    HrEmployee,
    HrEmployeeStatus,
    HrEventKind,
    HrSignature,
    HrSignChallenge,
    HrSigningKey,
    SignerRole,
    SigType,
)
from app.modules.hr_edo.schemas import (
    CreateDocumentsRequest,
    CreateEmployeeRequest,
    PreviewRequest,
    UpdateDocumentRequest,
    UpdateEmployeeRequest,
    normalize_phone,
)
from app.modules.users.models import User

log = logging.getLogger(__name__)

# Статусы, в которых номер телефона зафиксирован соглашением об УНЭП.
_PHONE_LOCKED = (EdoStatus.notified, EdoStatus.consent_signed, EdoStatus.active, EdoStatus.key_revoked)
_CANCELLABLE = (
    HrDocStatus.draft,
    HrDocStatus.frozen,
    HrDocStatus.awaiting_employer,
    HrDocStatus.sent,
    HrDocStatus.viewed,
    HrDocStatus.expired,
)

ALLOWED_SCAN_MIME = {"application/pdf", "image/jpeg", "image/png"}
SIG_MIME = "application/pkcs7-signature"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today_msk() -> date:
    return datetime.now(rendering.MSK).date()


def user_actor(user: User, ip: str | None, ua: str | None) -> Actor:
    return Actor(type="user", name=user.full_name, user_id=user.id, ip=ip, ua=ua)


# ════════════════════════════════════════════════════════════════════════════
# Сотрудники
# ════════════════════════════════════════════════════════════════════════════


async def get_employee(db: AsyncSession, employee_id: uuid.UUID, *, for_update: bool = False) -> HrEmployee:
    emp = await db.get(HrEmployee, employee_id, with_for_update=for_update, populate_existing=for_update)
    if emp is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Сотрудник не найден")
    return emp


async def list_employees(
    db: AsyncSession,
    *,
    q: str | None,
    edo_status: EdoStatus | None,
    employment_type: EmploymentType | None,
    status_: HrEmployeeStatus | None,
    page: int,
    page_size: int,
) -> tuple[list[HrEmployee], int]:
    stmt: Select[tuple[HrEmployee]] = select(HrEmployee)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                HrEmployee.full_name.ilike(like),
                HrEmployee.position.ilike(like),
                HrEmployee.email.ilike(like),
                HrEmployee.phone_e164.ilike(like),
            )
        )
    if edo_status is not None:
        stmt = stmt.where(HrEmployee.edo_status == edo_status)
    if employment_type is not None:
        stmt = stmt.where(HrEmployee.employment_type == employment_type)
    if status_ is not None:
        stmt = stmt.where(HrEmployee.status == status_)
    total = int((await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one())
    rows = (
        await db.execute(
            stmt.order_by(HrEmployee.full_name).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars()
    return list(rows), total


async def _ensure_user_free(db: AsyncSession, user_id: uuid.UUID, exclude: uuid.UUID | None = None) -> None:
    if await db.get(User, user_id) is None:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "user_not_found", "Пользователь CRM не найден")
    stmt = select(HrEmployee.id).where(HrEmployee.user_id == user_id)
    if exclude:
        stmt = stmt.where(HrEmployee.id != exclude)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "employee_user_taken",
            "Этот пользователь CRM уже привязан к другому сотруднику",
            details={"employeeId": str(existing)},
        )


async def create_employee(
    db: AsyncSession, payload: CreateEmployeeRequest, *, created_by: User, actor: Actor
) -> HrEmployee:
    if payload.user_id:
        await _ensure_user_free(db, payload.user_id)
    if payload.candidate_id and await db.get(Candidate, payload.candidate_id) is None:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "candidate_not_found", "Кандидат не найден")
    emp = HrEmployee(
        full_name=payload.full_name.strip(),
        position=payload.position.strip(),
        employment_type=payload.employment_type,
        phone_e164=payload.phone,
        email=payload.email,
        hired_at=payload.hired_at,
        user_id=payload.user_id,
        candidate_id=payload.candidate_id,
        status=HrEmployeeStatus.active,
        edo_status=EdoStatus.not_invited,
        created_by=created_by.id,
    )
    db.add(emp)
    await db.flush()
    await record_event(
        db,
        kind=HrEventKind.employee_created,
        actor=actor,
        employee_id=emp.id,
        payload={"candidateId": str(payload.candidate_id) if payload.candidate_id else None},
    )
    await db.commit()
    await db.refresh(emp)
    return emp


async def create_from_candidate(
    db: AsyncSession, candidate_id: uuid.UUID, *, created_by: User, actor: Actor
) -> HrEmployee:
    cand = await db.get(Candidate, candidate_id)
    if cand is None or cand.deleted_at is not None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Кандидат не найден")
    if cand.status != CandidateStatus.hired:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "candidate_not_hired",
            "Оформить можно только кандидата в статусе «Вышел на работу»",
        )
    existing = (
        await db.execute(select(HrEmployee.id).where(HrEmployee.candidate_id == candidate_id))
    ).scalar_one_or_none()
    if existing:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "employee_exists",
            "Сотрудник по этому кандидату уже заведён",
            details={"employeeId": str(existing)},
        )
    try:
        phone = normalize_phone(cand.phone)
    except ValueError:
        phone = None
    payload = CreateEmployeeRequest(
        full_name=cand.full_name,
        position=cand.role or "",
        employment_type=cand.employment_type,
        phone=phone,
        email=cand.email,
        candidate_id=cand.id,
    )
    return await create_employee(db, payload, created_by=created_by, actor=actor)


async def update_employee(
    db: AsyncSession, employee_id: uuid.UUID, payload: UpdateEmployeeRequest, *, actor: Actor
) -> HrEmployee:
    emp = await get_employee(db, employee_id, for_update=True)
    provided = payload.model_fields_set
    if "phone" in provided and payload.phone != emp.phone_e164 and emp.edo_status in _PHONE_LOCKED:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "phone_locked",
            "Номер зафиксирован в соглашении об УНЭП — используйте «Сменить телефон»",
        )
    if "user_id" in provided and payload.user_id and payload.user_id != emp.user_id:
        await _ensure_user_free(db, payload.user_id, exclude=emp.id)
    # Обязательные колонки: null в PATCH означает «не менять».
    required = ("full_name", "position", "employment_type", "status")
    nullable = ("email", "hired_at", "dismissed_at")
    for name in (*required, *nullable):
        if name not in provided:
            continue
        value = getattr(payload, name)
        if value is None and name in required:
            continue
        if isinstance(value, str):
            value = value.strip()
        setattr(emp, name, value)
    before = {
        "userId": str(emp.user_id) if emp.user_id else None,
        "phone": mask_phone(emp.phone_e164) if emp.phone_e164 else None,
        "status": emp.status.value,
    }
    if "phone" in provided:
        emp.phone_e164 = payload.phone
    if "user_id" in provided:
        emp.user_id = payload.user_id
    # Привязка к аккаунту CRM открывает доступ к «Моим документам» — фиксируем
    # в протоколе, как и остальные изменения карточки.
    changed = sorted(to_camel(name) for name in provided)
    if changed:
        await record_event(
            db,
            kind=HrEventKind.employee_updated,
            actor=actor,
            employee_id=emp.id,
            payload={
                "fields": changed,
                "before": before,
                "after": {
                    "userId": str(emp.user_id) if emp.user_id else None,
                    "phone": mask_phone(emp.phone_e164) if emp.phone_e164 else None,
                    "status": emp.status.value,
                },
            },
        )
    await db.commit()
    await db.refresh(emp)
    return emp


# ── Пригласить в КЭДО / согласие ────────────────────────────────────────────


def _employee_context(emp: HrEmployee) -> dict[str, Any]:
    phone = emp.phone_e164 or ""
    if phone.startswith("+7") and len(phone) == 12:
        d = phone[2:]
        phone = f"+7 {d[:3]} {d[3:6]}-{d[6:8]}-{d[8:]}"
    return {
        "full_name": emp.full_name,
        "position": emp.position,
        "phone": phone or "не указан",
        "email": emp.email or "",
        "hired_at": emp.hired_at,
        "employment_type": emp.employment_type.value,
    }


async def invite(
    db: AsyncSession, employee_id: uuid.UUID, *, user: User, actor: Actor
) -> tuple[HrEmployee, HrDocument, bool, str | None]:
    """Сформировать пакет согласия, выдать ссылку на портал, отправить письмо."""
    from app.modules.hr_edo import portal

    emp = await get_employee(db, employee_id, for_update=True)
    if emp.status != HrEmployeeStatus.active:
        raise ApiError(status.HTTP_409_CONFLICT, "employee_dismissed", "Сотрудник уволен")
    if emp.employment_type != EmploymentType.tk_rf:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "gph_contour",
            "ИП и самозанятые — не КЭДО: ГПХ-контур появится на Этапе 3",
        )
    if emp.edo_status not in (EdoStatus.not_invited, EdoStatus.notified, EdoStatus.refused):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "already_consented",
            "Согласие уже зарегистрировано",
        )
    if not emp.phone_e164:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "phone_missing",
            "Укажите номер мобильного телефона: он войдёт в соглашение об электронной подписи",
        )

    doc: HrDocument | None = None
    if emp.edo_consent_doc_id:
        existing = await db.get(HrDocument, emp.edo_consent_doc_id)
        if existing is not None and existing.status in (HrDocStatus.sent, HrDocStatus.viewed):
            doc = existing  # повторная отправка того же пакета
    if doc is None:
        doc = HrDocument(
            employee_id=emp.id,
            type_code=CONSENT_PACKAGE,
            title="Пакет согласия на КЭДО",
            doc_date=_today_msk(),
            status=HrDocStatus.draft,
            fields={},
            created_by=user.id,
        )
        db.add(doc)
        await db.flush()
        await record_event(db, kind=HrEventKind.created, actor=actor, document_id=doc.id, employee_id=emp.id)
        await _freeze(db, doc, emp, actor=actor, user=user)
        doc.status = HrDocStatus.sent
        doc.sent_at = _now()
        await record_event(db, kind=HrEventKind.sent, actor=actor, document_id=doc.id, employee_id=emp.id)
        emp.edo_consent_doc_id = doc.id
    emp.edo_status = EdoStatus.notified

    raw = await portal.issue_access_token(db, emp, created_by=user.id)
    url = notify.portal_url(raw)
    sent = await notify.email_consent_invite(to=emp.email, full_name=emp.full_name, url=url)
    await record_event(
        db,
        kind=HrEventKind.notified,
        actor=actor,
        document_id=doc.id,
        employee_id=emp.id,
        payload={"channel": "email" if sent else "link", "email": bool(emp.email)},
    )
    await notify.notify_user(
        db,
        user_id=emp.user_id,
        text="Вам направлен пакет согласия на кадровый электронный документооборот",
        document_id=doc.id,
    )
    await db.commit()
    await db.refresh(emp)
    await db.refresh(doc)
    return emp, doc, sent, (None if sent else url)


async def register_consent(
    db: AsyncSession,
    employee_id: uuid.UUID,
    *,
    sig_type: SigType,
    data: bytes,
    filename: str,
    mime: str,
    note: str | None,
    user: User,
    actor: Actor,
) -> HrEmployee:
    """Кадровик регистрирует подписанный пакет согласия (скан / .sig)."""
    from app.modules.hr_edo import portal

    emp = await get_employee(db, employee_id, for_update=True)
    if emp.edo_status not in (EdoStatus.notified, EdoStatus.refused):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "consent_state",
            "Согласие можно зарегистрировать после приглашения в КЭДО",
        )
    if not emp.edo_consent_doc_id:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "consent_package_missing",
            "Сначала сформируйте пакет согласия («Пригласить в КЭДО»)",
        )
    doc = await db.get(HrDocument, emp.edo_consent_doc_id, with_for_update=True)
    if doc is None or doc.status not in (HrDocStatus.sent, HrDocStatus.viewed, HrDocStatus.expired):
        raise ApiError(status.HTTP_409_CONFLICT, "consent_package_missing", "Пакет согласия не найден")
    t = get_doc_type(CONSENT_PACKAGE)
    assert t is not None
    if sig_type.value not in t.employee_sig:
        # Соглашения об УНЭП ещё нет — подписать пакет УНЭП ЛГ нельзя.
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "sig_type_not_allowed",
            "Пакет согласия подписывается на бумаге, Госключом или УКЭП",
        )
    _validate_upload(data, mime, sig=sig_type != SigType.paper)

    verification: dict[str, Any] = {"note": note} if note else {}
    if sig_type != SigType.paper:
        try:
            res = await crypto_service().verify(signature=data, digest=doc.content_streebog256 or "")
        except CryptoServiceError as exc:
            raise ApiError(status.HTTP_502_BAD_GATEWAY, exc.code, str(exc)) from exc
        if not res.valid:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "signature_invalid",
                "Подпись не прошла проверку для этого пакета согласия",
                details=res.details,
            )
        verification.update(res.details)

    kind = "scan" if sig_type == SigType.paper else "consent-sig"
    rec = await storage.put_file(
        db,
        document_id=doc.id,
        kind=kind,
        data=data,
        mime=mime if sig_type == SigType.paper else SIG_MIME,
        original_name=filename,
        owner_user_id=user.id,
    )
    sig = HrSignature(
        document_id=doc.id,
        signer_role=SignerRole.employee,
        employee_id=emp.id,
        user_id=user.id,
        signer_name=emp.full_name,
        sig_type=sig_type,
        signed_digest=doc.content_streebog256,
        signature_file_id=rec.id,
        verification=verification,
        ip=actor.ip,
        user_agent=(actor.ua or "")[:512] or None,
        signed_at=_now(),
        is_test=bool(verification.get("test")),
    )
    db.add(sig)
    doc.status = HrDocStatus.signed
    doc.signed_at = sig.signed_at
    emp.edo_status = EdoStatus.consent_signed
    await db.flush()
    await record_event(
        db,
        kind=HrEventKind.consent_registered,
        actor=actor,
        document_id=doc.id,
        employee_id=emp.id,
        payload={"sigType": sig_type.value, "fileId": str(rec.id), "sha256": storage.sha256_hex(data)},
    )
    raw = await portal.issue_access_token(db, emp, created_by=user.id)
    await notify.email_get_signature(to=emp.email, full_name=emp.full_name, url=notify.portal_url(raw))
    await notify.notify_user(
        db,
        user_id=emp.user_id,
        text="Согласие на КЭДО зарегистрировано — получите электронную подпись в «Моих документах»",
        document_id=doc.id,
    )
    await db.commit()
    await db.refresh(emp)
    return emp


async def refuse_edo(db: AsyncSession, employee_id: uuid.UUID, *, note: str | None, actor: Actor) -> HrEmployee:
    emp = await get_employee(db, employee_id, for_update=True)
    if emp.edo_status in (EdoStatus.active, EdoStatus.consent_signed, EdoStatus.key_revoked):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "consent_already_signed",
            "Согласие уже дано. Отзыв согласия оформляется заявлением работника.",
        )
    emp.edo_status = EdoStatus.refused
    await record_event(
        db, kind=HrEventKind.edo_refused, actor=actor, employee_id=emp.id, payload={"note": note}
    )
    await db.commit()
    await db.refresh(emp)
    return emp


async def revoke_key(
    db: AsyncSession, employee_id: uuid.UUID, *, reason: str, actor: Actor, commit: bool = True
) -> HrEmployee:
    emp = await get_employee(db, employee_id, for_update=True)
    if not emp.active_key_id:
        raise ApiError(status.HTTP_409_CONFLICT, "no_active_key", "У сотрудника нет действующего ключа")
    key = await db.get(HrSigningKey, emp.active_key_id, with_for_update=True)
    assert key is not None
    try:
        await crypto_service().revoke_key(key_id=key.crypto_key_id, reason=reason)
    except CryptoServiceError as exc:
        raise ApiError(status.HTTP_502_BAD_GATEWAY, exc.code, str(exc)) from exc
    key.revoked_at = _now()
    key.revoke_reason = reason
    emp.active_key_id = None
    emp.edo_status = EdoStatus.key_revoked
    await record_event(
        db,
        kind=HrEventKind.key_revoked,
        actor=actor,
        employee_id=emp.id,
        payload={"keyId": str(key.id), "fingerprint": key.fingerprint, "reason": reason},
    )
    if commit:
        await db.commit()
        await db.refresh(emp)
    return emp


async def change_phone(
    db: AsyncSession, employee_id: uuid.UUID, *, phone: str, reason: str, actor: Actor
) -> HrEmployee:
    """Смена номера: отзыв ключа и новый ключ по подтверждению нового номера.

    Основание (заявление работника или допсоглашение) кадровик прикладывает
    отдельным документом; здесь фиксируем факт и причину в протоколе.
    """
    emp = await get_employee(db, employee_id, for_update=True)
    if phone == emp.phone_e164:
        raise ApiError(status.HTTP_409_CONFLICT, "phone_same", "Это текущий номер сотрудника")
    old = emp.phone_e164
    if emp.active_key_id:
        await revoke_key(db, employee_id, reason=f"Смена номера телефона: {reason}", actor=actor, commit=False)
    if emp.edo_status == EdoStatus.notified and emp.edo_consent_doc_id:
        # Номер напечатан в пакете согласия — старый пакет недействителен.
        pkg = await db.get(HrDocument, emp.edo_consent_doc_id, with_for_update=True)
        if pkg is not None and pkg.status in _CANCELLABLE:
            pkg.status = HrDocStatus.cancelled
            pkg.cancel_reason = "Смена номера телефона до регистрации согласия"
            await record_event(
                db, kind=HrEventKind.cancelled, actor=actor, document_id=pkg.id, employee_id=emp.id,
                payload={"reason": pkg.cancel_reason},
            )
        emp.edo_consent_doc_id = None
        emp.edo_status = EdoStatus.not_invited
    emp.phone_e164 = phone
    emp.phone_verified_at = None
    await record_event(
        db,
        kind=HrEventKind.phone_changed,
        actor=actor,
        employee_id=emp.id,
        payload={"from": mask_phone(old) if old else None, "to": mask_phone(phone), "reason": reason},
    )
    await db.commit()
    await db.refresh(emp)
    return emp


# ════════════════════════════════════════════════════════════════════════════
# Документы
# ════════════════════════════════════════════════════════════════════════════


async def get_document(db: AsyncSession, document_id: uuid.UUID, *, for_update: bool = False) -> HrDocument:
    doc = await db.get(HrDocument, document_id, with_for_update=for_update, populate_existing=for_update)
    if doc is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Документ не найден")
    return doc


def _doc_type_or_422(code: str) -> DocType:
    t = get_doc_type(code)
    if t is None:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown_type", "Неизвестный тип документа")
    return t


async def list_documents(
    db: AsyncSession,
    *,
    q: str | None,
    status_: HrDocStatus | None,
    type_code: str | None,
    employee_id: uuid.UUID | None,
    awaiting_employer: bool | None,
    page: int,
    page_size: int,
) -> tuple[list[HrDocument], int]:
    stmt: Select[tuple[HrDocument]] = select(HrDocument).join(HrEmployee, HrEmployee.id == HrDocument.employee_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(HrDocument.title.ilike(like), HrDocument.number.ilike(like), HrEmployee.full_name.ilike(like))
        )
    if status_ is not None:
        stmt = stmt.where(HrDocument.status == status_)
    if awaiting_employer:
        stmt = stmt.where(HrDocument.status == HrDocStatus.awaiting_employer)
    if type_code:
        stmt = stmt.where(HrDocument.type_code == type_code)
    if employee_id:
        stmt = stmt.where(HrDocument.employee_id == employee_id)
    total = int((await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one())
    rows = (
        await db.execute(
            stmt.order_by(HrDocument.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars()
    return list(rows), total


async def render_preview(db: AsyncSession, payload: PreviewRequest) -> str:
    t = _doc_type_or_422(payload.type_code)
    if t.is_upload_only:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "upload_only", "Этот тип загружается готовым файлом")
    emp_ctx: dict[str, Any] = {
        "full_name": "Фамилия Имя Отчество",
        "position": "",
        "phone": "+7 ••• ••• ••-••",
        "email": "",
        "hired_at": None,
        "employment_type": "ТК РФ",
    }
    if payload.employee_id:
        emp_ctx = _employee_context(await get_employee(db, payload.employee_id))
    return rendering.render_document_html(
        t.template,
        title=payload.title or t.title,
        number=None,
        doc_date=payload.doc_date or _today_msk(),
        employee=emp_ctx,
        fields=payload.fields,
        draft=True,
    )


async def render_document_preview(db: AsyncSession, doc: HrDocument) -> str:
    t = _doc_type_or_422(doc.type_code)
    if t.is_upload_only:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "upload_only", "Документ загружен файлом")
    emp = await get_employee(db, doc.employee_id)
    return rendering.render_document_html(
        t.template,
        title=doc.title,
        number=doc.number,
        doc_date=doc.doc_date,
        employee=_employee_context(emp),
        fields=dict(doc.fields or {}),
        draft=doc.status == HrDocStatus.draft,
    )


async def create_documents(
    db: AsyncSession, payload: CreateDocumentsRequest, *, user: User, actor: Actor
) -> list[HrDocument]:
    t = _doc_type_or_422(payload.type_code)
    if t.code == CONSENT_PACKAGE:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "consent_via_invite",
            "Пакет согласия формируется кнопкой «Пригласить в КЭДО» в карточке сотрудника",
        )
    if t.is_upload_only:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "upload_only",
            "Этот тип документа загружается готовым файлом",
        )
    if t.stage > 1:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "type_unavailable", "Тип документа появится позже")
    ids = list(dict.fromkeys(payload.employee_ids))
    batch_id = uuid.uuid4() if len(ids) > 1 else None
    docs: list[HrDocument] = []
    for emp_id in ids:
        emp = await get_employee(db, emp_id)
        if emp.employment_type != EmploymentType.tk_rf and t.contour == "labor":
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "gph_contour",
                f"{emp.full_name}: ИП и самозанятым трудовые документы не оформляются",
            )
        doc = HrDocument(
            employee_id=emp.id,
            type_code=t.code,
            title=(payload.title or t.title).strip(),
            doc_date=payload.doc_date or _today_msk(),
            status=HrDocStatus.draft,
            fields=dict(payload.fields),
            batch_id=batch_id,
            created_by=user.id,
        )
        db.add(doc)
        await db.flush()
        await record_event(
            db, kind=HrEventKind.created, actor=actor, document_id=doc.id, employee_id=emp.id,
            payload={"typeCode": t.code, "batchId": str(batch_id) if batch_id else None},
        )
        if payload.freeze:
            await _freeze(db, doc, emp, actor=actor, user=user)
        docs.append(doc)
    await db.commit()
    for d in docs:
        await db.refresh(d)
    return docs


async def update_draft(
    db: AsyncSession, document_id: uuid.UUID, payload: UpdateDocumentRequest
) -> HrDocument:
    doc = await get_document(db, document_id, for_update=True)
    if doc.status != HrDocStatus.draft:
        raise ApiError(status.HTTP_409_CONFLICT, "not_draft", "Изменять можно только черновик")
    if payload.fields is not None:
        doc.fields = dict(payload.fields)
    if payload.title:
        doc.title = payload.title.strip()
    if payload.doc_date:
        doc.doc_date = payload.doc_date
    await db.commit()
    await db.refresh(doc)
    return doc


async def _next_number(db: AsyncSession, prefix: str, year: int) -> str:
    stmt = (
        pg_insert(HrDocCounter)
        .values(prefix=prefix, year=year, value=1)
        .on_conflict_do_update(
            index_elements=[HrDocCounter.prefix, HrDocCounter.year],
            set_={"value": HrDocCounter.value + 1},
        )
        .returning(HrDocCounter.value)
    )
    value = int((await db.execute(stmt)).scalar_one())
    return f"{prefix}-{year}-{value:04d}"


def _missing_fields(t: DocType, fields: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for f in t.fields:
        if not f.required:
            continue
        value = fields.get(f.key)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(f.label)
    return missing


def _status_after_freeze(t: DocType) -> HrDocStatus:
    if t.needs_employer_signature and t.sign_order == "employer_first":
        return HrDocStatus.awaiting_employer
    return HrDocStatus.frozen


async def _freeze(
    db: AsyncSession, doc: HrDocument, emp: HrEmployee, *, actor: Actor, user: User
) -> None:
    """Рендер PDF → хеши → S3 → `frozen`. После этого содержимое неизменно."""
    t = _doc_type_or_422(doc.type_code)
    missing = _missing_fields(t, dict(doc.fields or {}))
    if missing:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "fields_required",
            "Заполните обязательные поля: " + ", ".join(missing),
            details={"missing": missing},
        )
    doc.number = await _next_number(db, t.number_prefix, doc.doc_date.year)
    html = rendering.render_document_html(
        t.template,
        title=doc.title,
        number=doc.number,
        doc_date=doc.doc_date,
        employee=_employee_context(emp),
        fields=dict(doc.fields or {}),
        draft=False,
    )
    try:
        pdf = await rendering.html_to_pdf(html)
    except Exception as exc:
        log.exception("hr_edo: pdf render failed")
        raise ApiError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "pdf_render_failed",
            "Не удалось сформировать PDF на сервере",
            details={"errorType": exc.__class__.__name__},
        ) from exc
    await _store_source(db, doc, pdf, actor=actor, user=user, t=t)


async def _store_source(
    db: AsyncSession, doc: HrDocument, pdf: bytes, *, actor: Actor, user: User, t: DocType, mime: str = "application/pdf",
    filename: str | None = None,
) -> None:
    doc.content_sha256 = storage.sha256_hex(pdf)
    doc.content_streebog256 = storage.streebog256_hex(pdf)
    name = filename or f"{doc.title}{' № ' + doc.number if doc.number else ''}.pdf"
    rec = await storage.put_file(
        db, document_id=doc.id, kind="source", data=pdf, mime=mime, original_name=name, owner_user_id=user.id
    )
    doc.source_file_id = rec.id
    doc.frozen_at = _now()
    doc.status = HrDocStatus.archived_paper if t.paper_only else _status_after_freeze(t)
    await record_event(
        db,
        kind=HrEventKind.frozen,
        actor=actor,
        document_id=doc.id,
        employee_id=doc.employee_id,
        payload={
            "number": doc.number,
            "sha256": doc.content_sha256,
            "streebog256": doc.content_streebog256,
            "fileId": str(rec.id),
            "size": len(pdf),
        },
    )


async def freeze_document(db: AsyncSession, document_id: uuid.UUID, *, user: User, actor: Actor) -> HrDocument:
    doc = await get_document(db, document_id, for_update=True)
    if doc.status != HrDocStatus.draft:
        raise ApiError(status.HTTP_409_CONFLICT, "not_draft", "Документ уже сформирован")
    emp = await get_employee(db, doc.employee_id)
    await _freeze(db, doc, emp, actor=actor, user=user)
    await db.commit()
    await db.refresh(doc)
    return doc


def _validate_upload(data: bytes, mime: str, *, sig: bool) -> None:
    if not data:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "empty_file", "Пустой файл")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "file_too_large", "Файл больше 20 МБ")
    if not sig and mime not in ALLOWED_SCAN_MIME:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "unsupported_mime",
            "Допустимы PDF, JPG или PNG",
        )


async def upload_document(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    type_code: str,
    title: str | None,
    doc_date: date | None,
    data: bytes,
    filename: str,
    mime: str,
    user: User,
    actor: Actor,
) -> HrDocument:
    """Документ готовым файлом (upload_only) или скан бумажного (paper_only)."""
    t = _doc_type_or_422(type_code)
    if not t.is_upload_only:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "template_type",
            "Этот тип формируется по шаблону — используйте «Создать документ»",
        )
    if t.stage > 1:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "type_unavailable", "Тип документа появится позже")
    if not t.paper_only and mime != "application/pdf":
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "pdf_required", "Для подписи загрузите PDF")
    _validate_upload(data, mime, sig=False)
    emp = await get_employee(db, employee_id)
    doc = HrDocument(
        employee_id=emp.id,
        type_code=t.code,
        title=(title or t.title).strip(),
        doc_date=doc_date or _today_msk(),
        status=HrDocStatus.draft,
        fields={},
        created_by=user.id,
    )
    db.add(doc)
    await db.flush()
    await record_event(
        db, kind=HrEventKind.created, actor=actor, document_id=doc.id, employee_id=emp.id,
        payload={"typeCode": t.code, "uploaded": True, "fileName": filename},
    )
    doc.number = await _next_number(db, t.number_prefix, doc.doc_date.year)
    await _store_source(db, doc, data, actor=actor, user=user, t=t, mime=mime, filename=filename)
    await db.commit()
    await db.refresh(doc)
    return doc


async def send_documents(
    db: AsyncSession, ids: list[uuid.UUID], *, user: User, actor: Actor
) -> tuple[list[HrDocument], dict[str, str]]:
    """Отправить документы сотрудникам: одно письмо на сотрудника."""
    from app.modules.hr_edo import portal

    docs: list[HrDocument] = []
    for doc_id in dict.fromkeys(ids):
        doc = await get_document(db, doc_id, for_update=True)
        t = _doc_type_or_422(doc.type_code)
        if t.paper_only:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "paper_only",
                f"«{doc.title}» ведётся только на бумаге (ч. 3 ст. 22.1 ТК РФ)",
            )
        if t.code == CONSENT_PACKAGE:
            raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "consent_via_invite", "Пакет согласия отправляется приглашением")
        if doc.status == HrDocStatus.awaiting_employer:
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "employer_signature_required",
                f"«{doc.title}»: сначала нужна подпись работодателя",
            )
        if doc.status != HrDocStatus.frozen:
            raise ApiError(status.HTTP_409_CONFLICT, "invalid_status", f"«{doc.title}» нельзя отправить в текущем статусе")
        docs.append(doc)

    by_employee: dict[uuid.UUID, list[HrDocument]] = {}
    for doc in docs:
        by_employee.setdefault(doc.employee_id, []).append(doc)

    due_days = get_settings().hr_edo_sign_due_days
    links: dict[str, str] = {}
    for emp_id, emp_docs in by_employee.items():
        emp = await get_employee(db, emp_id)
        if emp.edo_status != EdoStatus.active or not emp.active_key_id:
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "employee_not_ready",
                f"{emp.full_name} ещё не получил(а) электронную подпись: сначала согласие на КЭДО",
                details={"employeeId": str(emp.id)},
            )
        now = _now()
        for doc in emp_docs:
            doc.status = HrDocStatus.sent
            doc.sent_at = now
            doc.due_at = now + timedelta(days=due_days)
            await record_event(db, kind=HrEventKind.sent, actor=actor, document_id=doc.id, employee_id=emp.id)
        raw = await portal.issue_access_token(db, emp, created_by=user.id)
        url = notify.portal_url(raw) if not emp.user_id else notify.my_docs_url()
        sent = await notify.email_documents_to_sign(
            to=emp.email, full_name=emp.full_name, titles=[_doc_label(d) for d in emp_docs], url=url
        )
        if not sent and not emp.user_id:
            links[str(emp.id)] = url
        for doc in emp_docs:
            await record_event(
                db, kind=HrEventKind.notified, actor=actor, document_id=doc.id, employee_id=emp.id,
                payload={"channel": "email" if sent else ("crm" if emp.user_id else "link")},
            )
            await notify.notify_user(
                db, user_id=emp.user_id, text=f"Документ на подпись: {_doc_label(doc)}", document_id=doc.id
            )
    await db.commit()
    for doc in docs:
        await db.refresh(doc)
    return docs, links


def _doc_label(doc: HrDocument) -> str:
    return f"{doc.title} № {doc.number}" if doc.number else doc.title


async def remind(db: AsyncSession, document_id: uuid.UUID, *, user: User, actor: Actor) -> tuple[HrDocument, str | None]:
    from app.modules.hr_edo import portal

    doc = await get_document(db, document_id, for_update=True)
    if doc.status not in (HrDocStatus.sent, HrDocStatus.viewed):
        raise ApiError(status.HTTP_409_CONFLICT, "invalid_status", "Напоминать можно только о неподписанном документе")
    emp = await get_employee(db, doc.employee_id)
    raw = await portal.issue_access_token(db, emp, created_by=user.id)
    url = notify.portal_url(raw) if not emp.user_id else notify.my_docs_url()
    sent = await notify.email_documents_to_sign(
        to=emp.email, full_name=emp.full_name, titles=[_doc_label(doc)], url=url, reminder=True
    )
    doc.last_reminded_at = _now()
    await record_event(
        db, kind=HrEventKind.notified, actor=actor, document_id=doc.id, employee_id=emp.id,
        payload={"reminder": True, "channel": "email" if sent else "link"},
    )
    await notify.notify_user(db, user_id=emp.user_id, text=f"Напоминание: подпишите «{_doc_label(doc)}»", document_id=doc.id)
    await db.commit()
    await db.refresh(doc)
    return doc, (None if sent or emp.user_id else url)


async def cancel_document(db: AsyncSession, document_id: uuid.UUID, *, reason: str, actor: Actor) -> HrDocument:
    doc = await get_document(db, document_id, for_update=True)
    if doc.status not in _CANCELLABLE:
        raise ApiError(status.HTTP_409_CONFLICT, "invalid_status", "Подписанный или отклонённый документ отменить нельзя")
    doc.status = HrDocStatus.cancelled
    doc.cancel_reason = reason
    await record_event(
        db, kind=HrEventKind.cancelled, actor=actor, document_id=doc.id, employee_id=doc.employee_id,
        payload={"reason": reason},
    )
    if doc.type_code == CONSENT_PACKAGE:
        emp = await get_employee(db, doc.employee_id, for_update=True)
        if emp.edo_consent_doc_id == doc.id and emp.edo_status == EdoStatus.notified:
            emp.edo_consent_doc_id = None
            emp.edo_status = EdoStatus.not_invited
    await db.commit()
    await db.refresh(doc)
    return doc


async def _signatures(db: AsyncSession, doc_id: uuid.UUID) -> list[HrSignature]:
    return list(
        (await db.execute(select(HrSignature).where(HrSignature.document_id == doc_id).order_by(HrSignature.signed_at)))
        .scalars()
    )


def completion_status(doc: HrDocument, t: DocType, sigs: list[HrSignature]) -> HrDocStatus:
    employee_done = not t.employee_signs or any(s.signer_role == SignerRole.employee for s in sigs)
    employer_done = not t.needs_employer_signature or any(s.signer_role == SignerRole.employer for s in sigs)
    if employee_done and employer_done:
        return HrDocStatus.signed
    if employee_done:
        return HrDocStatus.awaiting_employer
    if employer_done and doc.sent_at is None:
        return HrDocStatus.frozen
    return doc.status


async def employer_signature(
    db: AsyncSession,
    document_id: uuid.UUID,
    *,
    data: bytes,
    filename: str,
    user: User,
    actor: Actor,
) -> HrDocument:
    """Этап 1: директор подписывает УКЭП вне системы и загружает `.sig`."""
    doc = await get_document(db, document_id, for_update=True)
    t = _doc_type_or_422(doc.type_code)
    if not t.needs_employer_signature:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "no_employer_signature", "Этот документ работодатель не подписывает")
    if doc.status != HrDocStatus.awaiting_employer:
        raise ApiError(status.HTTP_409_CONFLICT, "invalid_status", "Документ не ждёт подписи работодателя")
    sigs = await _signatures(db, doc.id)
    if any(s.signer_role == SignerRole.employer for s in sigs):
        raise ApiError(status.HTTP_409_CONFLICT, "already_signed", "Подпись работодателя уже загружена")
    _validate_upload(data, SIG_MIME, sig=True)
    try:
        res = await crypto_service().verify(signature=data, digest=doc.content_streebog256 or "")
    except CryptoServiceError as exc:
        raise ApiError(status.HTTP_502_BAD_GATEWAY, exc.code, str(exc)) from exc
    if not res.valid:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "signature_invalid",
            "Подпись не прошла проверку: она сделана не для этого файла или повреждена",
            details=res.details,
        )
    rec = await storage.put_file(
        db, document_id=doc.id, kind="employer-sig", data=data, mime=SIG_MIME,
        original_name=filename or "employer.sig", owner_user_id=user.id,
    )
    details = res.details
    sig = HrSignature(
        document_id=doc.id,
        signer_role=SignerRole.employer,
        user_id=user.id,
        signer_name=str(details.get("subject") or get_settings().hr_edo_director_name or user.full_name),
        sig_type=SigType.ukep,
        signed_digest=doc.content_streebog256,
        signature_file_id=rec.id,
        cert_subject=details.get("subject"),
        cert_issuer=details.get("issuer"),
        cert_serial=details.get("serial"),
        verification=details,
        ip=actor.ip,
        user_agent=(actor.ua or "")[:512] or None,
        signed_at=_now(),
        is_test=bool(details.get("test")),
    )
    db.add(sig)
    await db.flush()
    sigs.append(sig)
    await record_event(
        db, kind=HrEventKind.employer_signed, actor=actor, document_id=doc.id, employee_id=doc.employee_id,
        payload={"signatureId": str(sig.id), "fileId": str(rec.id), "checked": details.get("checked", True)},
    )
    doc.status = completion_status(doc, t, sigs)
    if doc.status == HrDocStatus.signed:
        doc.signed_at = _now()
    await db.commit()
    if doc.status == HrDocStatus.signed:
        # Лист подписания — после фиксации подписи (Playwright не держит замок протокола).
        await build_stamped(db, doc)
        await db.commit()
    await db.refresh(doc)
    return doc


async def paper_signed(
    db: AsyncSession,
    document_id: uuid.UUID,
    *,
    data: bytes,
    filename: str,
    mime: str,
    user: User,
    actor: Actor,
) -> HrDocument:
    """Бумажный контур: сотрудник подписал оригинал, кадровик загружает скан."""
    doc = await get_document(db, document_id, for_update=True)
    t = _doc_type_or_422(doc.type_code)
    if doc.type_code == CONSENT_PACKAGE:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "use_consent", "Согласие регистрируется в карточке сотрудника")
    if doc.status not in (HrDocStatus.frozen, HrDocStatus.sent, HrDocStatus.viewed, HrDocStatus.expired):
        raise ApiError(status.HTTP_409_CONFLICT, "invalid_status", "Документ нельзя отметить подписанным на бумаге")
    _validate_upload(data, mime, sig=False)
    rec = await storage.put_file(
        db, document_id=doc.id, kind="paper-scan", data=data, mime=mime, original_name=filename, owner_user_id=user.id
    )
    emp = await get_employee(db, doc.employee_id)
    sig = HrSignature(
        document_id=doc.id,
        signer_role=SignerRole.employee,
        employee_id=emp.id,
        user_id=user.id,
        signer_name=emp.full_name,
        sig_type=SigType.paper,
        signed_digest=doc.content_streebog256,
        signature_file_id=rec.id,
        verification={"registeredBy": user.full_name},
        signed_at=_now(),
    )
    db.add(sig)
    await db.flush()
    sigs = await _signatures(db, doc.id)
    await record_event(
        db, kind=HrEventKind.paper_signed, actor=actor, document_id=doc.id, employee_id=emp.id,
        payload={"fileId": str(rec.id), "sha256": storage.sha256_hex(data)},
    )
    doc.status = completion_status(doc, t, sigs)
    if doc.status == HrDocStatus.signed:
        doc.signed_at = _now()
    await db.commit()
    await db.refresh(doc)
    return doc


# ── Лист подписания ─────────────────────────────────────────────────────────


async def build_stamped(db: AsyncSession, doc: HrDocument) -> None:
    """PDF с листом подписания → `stamped_file_id`. Исходник не меняется.

    Ошибка рендера не срывает подписание: лист можно пересобрать позже
    (GET /documents/{id}/file?kind=stamped соберёт его по требованию).
    """
    if not doc.source_file_id:
        return
    try:
        sigs = await _signatures(db, doc.id)
        key_ids = {s.signing_key_id for s in sigs if s.signing_key_id}
        ch_ids = {s.challenge_id for s in sigs if s.challenge_id}
        fps: dict[uuid.UUID, str] = {}
        if key_ids:
            fps = dict(
                (await db.execute(select(HrSigningKey.id, HrSigningKey.fingerprint).where(HrSigningKey.id.in_(key_ids))))
                .tuples()
                .all()
            )
        phones: dict[uuid.UUID, str] = {}
        if ch_ids:
            phones = dict(
                (await db.execute(select(HrSignChallenge.id, HrSignChallenge.phone_masked).where(HrSignChallenge.id.in_(ch_ids))))
                .tuples()
                .all()
            )
        ordered = sorted(sigs, key=lambda s: (s.signer_role != SignerRole.employer, s.signed_at))
        context = {
            "generated_at": _now(),
            "document": {
                "id": str(doc.id),
                "title": doc.title,
                "number": doc.number,
                "doc_date": doc.doc_date,
                "sha256": doc.content_sha256,
                "streebog256": doc.content_streebog256,
            },
            "signatures": [
                {
                    "id": str(s.id),
                    "role_label": "Работодатель" if s.signer_role == SignerRole.employer else "Работник",
                    "name": s.signer_name,
                    "type_label": SIG_TYPE_LABEL[s.sig_type] + (" (тестовая)" if s.is_test else ""),
                    "fingerprint": fps.get(s.signing_key_id) if s.signing_key_id else None,
                    "phone": phones.get(s.challenge_id) if s.challenge_id else None,
                    "cert_subject": s.cert_subject,
                    "cert_issuer": s.cert_issuer,
                    "cert_serial": s.cert_serial,
                    "cert_valid": (
                        f"{rendering.date_short(s.cert_valid_from)} - {rendering.date_short(s.cert_valid_to)}"
                        if s.cert_valid_from and s.cert_valid_to
                        else None
                    ),
                    "tsp_time": s.tsp_time,
                    "ip": str(s.ip) if s.ip else None,
                    "signed_at": s.signed_at,
                    "is_test": s.is_test,
                }
                for s in ordered
            ],
            "any_test": any(s.is_test for s in sigs),
            "verify_url": f"{get_settings().app_base_url.rstrip('/')}/verify/<ID подписи>",
        }
        sheet_pdf = await rendering.html_to_pdf(rendering.render_signing_sheet_html(context))
        source = await storage.read_verified(db, doc.source_file_id, doc.content_sha256)
        stamped = rendering.append_pdf(source, sheet_pdf)
        rec = await storage.put_file(
            db,
            document_id=doc.id,
            kind="stamped",
            data=stamped,
            mime="application/pdf",
            original_name=f"{_doc_label(doc)} (с листом подписания).pdf",
            owner_user_id=None,
        )
        doc.stamped_file_id = rec.id
    except Exception:
        log.exception("hr_edo: signing sheet build failed for %s", doc.id)


async def document_file(
    db: AsyncSession, doc: HrDocument, *, kind: str
) -> tuple[bytes, str]:
    """Байты PDF (исходник или с листом подписания) и имя файла."""
    if kind == "stamped":
        if doc.stamped_file_id is None and doc.status == HrDocStatus.signed:
            await build_stamped(db, doc)
            await db.commit()
        if doc.stamped_file_id is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Лист подписания ещё не сформирован")
        rec, data = await storage.read_file(db, doc.stamped_file_id)
        return data, rec.original_name
    if doc.source_file_id is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Документ ещё не сформирован")
    data = await storage.read_verified(db, doc.source_file_id, doc.content_sha256)
    return data, f"{_doc_label(doc)}.pdf"


async def signature_file(db: AsyncSession, doc: HrDocument, signature_id: uuid.UUID) -> tuple[bytes, str, str]:
    sig = await db.get(HrSignature, signature_id)
    if sig is None or sig.document_id != doc.id or sig.signature_file_id is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Файл подписи не найден")
    rec, data = await storage.read_file(db, sig.signature_file_id)
    role = "employer" if sig.signer_role == SignerRole.employer else "employee"
    name = rec.original_name if sig.sig_type == SigType.paper else f"{doc.number or doc.id}.{role}.sig"
    return data, name, rec.mime


# ── Протокол ────────────────────────────────────────────────────────────────


async def list_events(
    db: AsyncSession,
    *,
    document_id: uuid.UUID | None,
    employee_id: uuid.UUID | None,
    kind: HrEventKind | None,
    page: int,
    page_size: int,
) -> tuple[list[tuple[HrDocEvent, str | None, str | None]], int]:
    stmt = (
        select(HrDocEvent, HrDocument.title, HrEmployee.full_name)
        .outerjoin(HrDocument, HrDocument.id == HrDocEvent.document_id)
        .outerjoin(HrEmployee, HrEmployee.id == HrDocEvent.employee_id)
    )
    count = select(func.count(HrDocEvent.id))
    if document_id:
        stmt = stmt.where(HrDocEvent.document_id == document_id)
        count = count.where(HrDocEvent.document_id == document_id)
    if employee_id:
        stmt = stmt.where(HrDocEvent.employee_id == employee_id)
        count = count.where(HrDocEvent.employee_id == employee_id)
    if kind:
        stmt = stmt.where(HrDocEvent.kind == kind)
        count = count.where(HrDocEvent.kind == kind)
    order = HrDocEvent.id.asc() if document_id else HrDocEvent.id.desc()
    total = int((await db.execute(count)).scalar_one())
    rows = (await db.execute(stmt.order_by(order).offset((page - 1) * page_size).limit(page_size))).tuples().all()
    return [(ev, title, name) for ev, title, name in rows], total
