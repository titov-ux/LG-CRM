"""Подписание документов сотрудником (портал и «Мои документы»).

Сценарий B, шаги 5–9 плана:

1. сотрудник открывает документ (`viewed`), прокручивает до конца
   (`viewed_to_end`) и отмечает «Я ознакомлен(а)»;
2. `challenges` — SMS-код для набора документов; код привязан к хешам
   документов (`digests_hash`) и к `purpose=sign`;
3. `confirm` — код верный → для каждого документа: сверка файла в S3 с
   замороженным хешем → одноразовый `activation_token` (JWT 60 с,
   привязан к key_id + digest + challenge_id) → crypto-service `/sign`
   (CAdES-T) → `/verify` → `.sig` в S3 → `hr_signatures` → событие
   `signed` → лист подписания. Несколько документов — одна активация кодом,
   отдельная подпись на каждый (ч. 4 ст. 6 ФЗ-63).

Бэкенд без кода подписать не может: activation_token выдаётся только здесь,
после проверки кода, а crypto-service подписывает только хеш из токена и
только один раз.
"""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.integrations.crypto_service import (
    ACTIVATION_AUDIENCE,
    CryptoServiceError,
    SignResult,
    crypto_service,
)
from app.modules.hr_edo import notify, otp, service, storage
from app.modules.hr_edo.doc_types import CONSENT_PACKAGE, get_doc_type
from app.modules.hr_edo.dto import PENDING_FOR_EMPLOYEE, employee_can_sign
from app.modules.hr_edo.evidence import Actor, record_event
from app.modules.hr_edo.models import (
    ChallengePurpose,
    HrDocEvent,
    HrDocStatus,
    HrDocument,
    HrEmployee,
    HrEventKind,
    HrSignature,
    HrSigningKey,
    SignerRole,
    SigType,
)

ACTIVATION_TTL = timedelta(seconds=60)

# Документы, которые сотрудник видит: всё, что ему отправлено, кроме
# черновиков и отменённых до отправки.
_VISIBLE = (
    HrDocStatus.sent,
    HrDocStatus.viewed,
    HrDocStatus.signed,
    HrDocStatus.rejected,
    HrDocStatus.expired,
    HrDocStatus.awaiting_employer,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_activation_token(*, key_id: str, digest: str, challenge_id: uuid.UUID) -> str:
    now = _now()
    return jwt.encode(
        {
            "sub": key_id,
            "dig": digest,
            "chl": str(challenge_id),
            "jti": uuid.uuid4().hex,
            "aud": ACTIVATION_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + ACTIVATION_TTL).timestamp()),
        },
        get_settings().hr_edo_activation_secret,
        algorithm="HS256",
    )


async def list_employee_documents(db: AsyncSession, employee: HrEmployee) -> list[HrDocument]:
    rows = (
        await db.execute(
            select(HrDocument)
            .where(
                HrDocument.employee_id == employee.id,
                HrDocument.sent_at.is_not(None),
                HrDocument.status.in_(_VISIBLE),
            )
            .order_by(HrDocument.sent_at.desc())
        )
    ).scalars()
    return list(rows)


async def get_employee_document(
    db: AsyncSession, employee: HrEmployee, document_id: uuid.UUID, *, for_update: bool = False
) -> HrDocument:
    doc = await db.get(HrDocument, document_id, with_for_update=for_update, populate_existing=for_update)
    # Чужой или ещё не отправленный документ — 404, без подсказок о существовании.
    if doc is None or doc.employee_id != employee.id or doc.sent_at is None or doc.status not in _VISIBLE:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Документ не найден")
    return doc


async def employee_file(db: AsyncSession, employee: HrEmployee, document_id: uuid.UUID) -> tuple[bytes, str]:
    doc = await get_employee_document(db, employee, document_id)
    kind = "stamped" if doc.status == HrDocStatus.signed and doc.stamped_file_id else "source"
    return await service.document_file(db, doc, kind=kind)


async def mark_viewed(
    db: AsyncSession, employee: HrEmployee, document_id: uuid.UUID, *, to_end: bool, actor: Actor
) -> HrDocument:
    doc = await get_employee_document(db, employee, document_id, for_update=True)
    kind = HrEventKind.viewed_to_end if to_end else HrEventKind.viewed
    await record_event(db, kind=kind, actor=actor, document_id=doc.id, employee_id=employee.id)
    if doc.status == HrDocStatus.sent:
        doc.status = HrDocStatus.viewed
    if doc.viewed_at is None:
        doc.viewed_at = _now()
    await db.commit()
    await db.refresh(doc)
    return doc


async def _signable(db: AsyncSession, employee: HrEmployee, ids: Sequence[uuid.UUID]) -> list[HrDocument]:
    docs: list[HrDocument] = []
    for doc_id in dict.fromkeys(ids):
        doc = await get_employee_document(db, employee, doc_id, for_update=True)
        t = get_doc_type(doc.type_code)
        if doc.type_code == CONSENT_PACKAGE:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "consent_external",
                "Пакет согласия подписывается вне системы: на бумаге, Госключом или УКЭП",
            )
        if not employee_can_sign(doc, employee, t):
            if doc.status not in PENDING_FOR_EMPLOYEE:
                raise ApiError(status.HTTP_409_CONFLICT, "invalid_status", f"«{doc.title}» уже не ждёт подписи")
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "key_required",
                "Сначала получите электронную подпись",
            )
        if not doc.content_streebog256 or not doc.source_file_id:
            raise ApiError(status.HTTP_409_CONFLICT, "not_frozen", "Документ не сформирован")
        # Сценарий B, шаг 5: подписать можно только прочитанный до конца документ.
        read_to_end = (
            await db.execute(
                select(HrDocEvent.id)
                .where(
                    HrDocEvent.document_id == doc.id,
                    HrDocEvent.employee_id == employee.id,
                    HrDocEvent.kind == HrEventKind.viewed_to_end,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if read_to_end is None:
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "not_read",
                f"Откройте «{doc.title}» и прокрутите до конца — подписать можно только прочитанный документ",
            )
        docs.append(doc)
    return docs


def _subject(docs: Sequence[HrDocument]) -> str:
    if len(docs) == 1:
        d = docs[0]
        return f"«{d.title}{' № ' + d.number if d.number else ''}»"
    return f"{len(docs)} документов"


async def request_sign_challenge(
    db: AsyncSession,
    redis: Redis,
    employee: HrEmployee,
    *,
    document_ids: Sequence[uuid.UUID],
    actor: Actor,
) -> otp.IssuedChallenge:
    docs = await _signable(db, employee, document_ids)
    issued = await otp.create_challenge(
        db,
        redis,
        employee=employee,
        purpose=ChallengePurpose.sign,
        actor=actor,
        document_ids=[d.id for d in docs],
        digests=[d.content_streebog256 or "" for d in docs],
        subject=_subject(docs),
    )
    await db.commit()
    return issued


async def _record_integrity_failure(db: AsyncSession, doc_id: uuid.UUID, employee_id: uuid.UUID, actor: Actor) -> None:
    """Подмена файла — событие в протоколе отдельной транзакцией (основная откатывается)."""
    await db.rollback()
    await record_event(
        db,
        kind=HrEventKind.integrity_failed,
        actor=actor,
        document_id=doc_id,
        employee_id=employee_id,
        payload={"stage": "sign"},
    )
    await db.commit()


async def confirm_and_sign(
    db: AsyncSession,
    employee: HrEmployee,
    *,
    challenge_id: uuid.UUID,
    code: str,
    actor: Actor,
) -> list[HrDocument]:
    emp = await db.get(HrEmployee, employee.id, with_for_update=True, populate_existing=True)
    assert emp is not None
    challenge = await otp.confirm_challenge(
        db, employee=emp, challenge_id=challenge_id, code=code, purpose=ChallengePurpose.sign
    )
    docs = await _signable(db, emp, challenge.document_ids)
    if otp.digests_hash([d.content_streebog256 or "" for d in docs]) != challenge.digests_hash:
        # Код выдан для другого набора документов (или документы изменились).
        await db.rollback()
        raise ApiError(status.HTTP_409_CONFLICT, "otp_scope_mismatch", "Код выдан для другого набора документов")
    key = await db.get(HrSigningKey, emp.active_key_id, populate_existing=True) if emp.active_key_id else None
    if key is None or key.revoked_at is not None:
        await db.rollback()
        raise ApiError(status.HTTP_409_CONFLICT, "key_revoked", "Ключ отозван — получите новую подпись")

    # Фаза 1: криптография и файлы подписей — без записи в протокол, чтобы не
    # держать глобальный замок хеш-цепочки на время обращений к crypto-service.
    crypto = crypto_service()
    prepared: list[tuple[HrDocument, SignResult, dict[str, object], uuid.UUID]] = []
    for doc in docs:
        digest = doc.content_streebog256 or ""
        # Подмена файла в S3 после заморозки → 409, подпись не создаётся.
        try:
            pdf = await storage.read_verified(db, doc.source_file_id, doc.content_sha256)  # type: ignore[arg-type]
            if storage.streebog256_hex(pdf) != digest:
                raise ApiError(status.HTTP_409_CONFLICT, "integrity_error", "Файл документа не совпадает с замороженным хешем")
        except ApiError as exc:
            detail: dict[str, object] = exc.detail if isinstance(exc.detail, dict) else {}
            if detail.get("code") == "integrity_error":
                await _record_integrity_failure(db, doc.id, emp.id, actor)
            else:
                await db.rollback()
            raise
        token = issue_activation_token(key_id=key.crypto_key_id, digest=digest, challenge_id=challenge.id)
        try:
            result = await crypto.sign(key_id=key.crypto_key_id, digest=digest, activation_token=token)
            check = await crypto.verify(
                signature=result.signature, digest=digest, public_key=key.public_key, key_id=key.crypto_key_id
            )
        except CryptoServiceError as exc:
            await db.rollback()
            raise ApiError(status.HTTP_502_BAD_GATEWAY, exc.code, "Сервис электронной подписи недоступен") from exc
        if not check.valid:
            await db.rollback()
            raise ApiError(status.HTTP_502_BAD_GATEWAY, "signature_verify_failed", "Подпись не прошла проверку")
        rec = await storage.put_file(
            db,
            document_id=doc.id,
            kind="employee-sig",
            data=result.signature,
            mime=service.SIG_MIME,
            original_name=f"{doc.number or doc.id}.employee.sig",
            owner_user_id=None,
        )
        prepared.append((doc, result, dict(check.details), rec.id))

    # Фаза 2: подписи, статусы и протокол — одной короткой транзакцией.
    signed: list[HrDocument] = []
    for doc, result, details, file_id in prepared:
        digest = doc.content_streebog256 or ""
        sig = HrSignature(
            id=uuid.uuid4(),
            document_id=doc.id,
            signer_role=SignerRole.employee,
            employee_id=emp.id,
            signer_name=emp.full_name,
            sig_type=SigType.unep_lg,
            signing_key_id=key.id,
            signed_digest=digest,
            signature_file_id=file_id,
            tsp_time=result.tsp_time,
            verification=details,
            challenge_id=challenge.id,
            ip=actor.ip,
            user_agent=(actor.ua or "")[:512] or None,
            signed_at=_now(),
            is_test=result.is_test,
        )
        db.add(sig)
        await db.flush()
        await record_event(
            db,
            kind=HrEventKind.signed,
            actor=actor,
            document_id=doc.id,
            employee_id=emp.id,
            payload={
                "signatureId": str(sig.id),
                "sigType": SigType.unep_lg.value,
                "keyId": str(key.id),
                "fingerprint": key.fingerprint,
                "digest": digest,
                "challengeId": str(challenge.id),
                "phone": challenge.phone_masked,
                "tspTime": result.tsp_time.isoformat() if result.tsp_time else None,
                "isTest": result.is_test,
            },
        )
        t = get_doc_type(doc.type_code)
        assert t is not None
        sigs = list(
            (await db.execute(select(HrSignature).where(HrSignature.document_id == doc.id))).scalars()
        )
        doc.status = service.completion_status(doc, t, sigs)
        if doc.status == HrDocStatus.signed:
            doc.signed_at = sig.signed_at
        signed.append(doc)

    for doc in signed:
        await notify.notify_user(
            db,
            user_id=doc.created_by,
            text=f"{emp.full_name} подписал(а): {doc.title}{' № ' + doc.number if doc.number else ''}",
            document_id=doc.id,
            target="hr",
        )
    await db.commit()

    # Лист подписания (Playwright + S3) — после фиксации подписи: сбой рендера
    # не влияет на подпись, лист соберётся по требованию при скачивании.
    for doc in signed:
        if doc.status == HrDocStatus.signed:
            await service.build_stamped(db, doc)
    await db.commit()
    for doc in signed:
        await db.refresh(doc)
    return signed


async def reject(
    db: AsyncSession, employee: HrEmployee, document_id: uuid.UUID, *, reason: str, actor: Actor
) -> HrDocument:
    doc = await get_employee_document(db, employee, document_id, for_update=True)
    if doc.status not in PENDING_FOR_EMPLOYEE:
        raise ApiError(status.HTTP_409_CONFLICT, "invalid_status", "Документ уже не ждёт подписи")
    doc.status = HrDocStatus.rejected
    doc.reject_reason = reason
    await record_event(
        db, kind=HrEventKind.rejected, actor=actor, document_id=doc.id, employee_id=employee.id,
        payload={"reason": reason},
    )
    await notify.notify_user(
        db,
        user_id=doc.created_by,
        text=f"{employee.full_name} отказался(-лась) подписать «{doc.title}»: {reason}",
        document_id=doc.id,
        target="hr",
    )
    await db.commit()
    await db.refresh(doc)
    return doc
