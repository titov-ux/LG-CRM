"""Выпуск ключа УНЭП ЛГ по SMS-подтверждению.

Порядок (сценарий A, шаг 4 плана):
1. согласие на КЭДО + соглашение об УНЭП зарегистрированы (`consent_signed`);
2. `key/otp` — SMS на номер из соглашения (`purpose=key_issue`);
3. `key/issue` — код верный → `crypto-service POST /keys` → запись в
   реестре `hr_signing_keys` → статус `active`; отпечаток показывается на
   экране и уходит на почту.

Без зарегистрированного согласия ключ не выпускается никогда.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.integrations.crypto_service import CryptoServiceError, crypto_service
from app.modules.hr_edo import notify, otp, rendering, storage
from app.modules.hr_edo.evidence import Actor, record_event
from app.modules.hr_edo.models import (
    ChallengePurpose,
    EdoStatus,
    HrEmployee,
    HrEventKind,
    HrSigningKey,
)

_CAN_ISSUE = (EdoStatus.consent_signed, EdoStatus.key_revoked)


def _ensure_can_issue(emp: HrEmployee) -> None:
    if emp.edo_status == EdoStatus.active and emp.active_key_id:
        raise ApiError(status.HTTP_409_CONFLICT, "key_already_issued", "Электронная подпись уже выпущена")
    if emp.edo_status not in _CAN_ISSUE or not emp.edo_consent_doc_id:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "consent_required",
            "Подпись выпускается только после регистрации согласия на КЭДО",
        )


async def request_key_otp(
    db: AsyncSession, redis: Redis, employee: HrEmployee, *, actor: Actor
) -> otp.IssuedChallenge:
    _ensure_can_issue(employee)
    issued = await otp.create_challenge(
        db, redis, employee=employee, purpose=ChallengePurpose.key_issue, actor=actor
    )
    await db.commit()
    return issued


async def issue_key(
    db: AsyncSession,
    employee: HrEmployee,
    *,
    challenge_id: uuid.UUID,
    code: str,
    actor: Actor,
) -> HrSigningKey:
    emp = await db.get(HrEmployee, employee.id, with_for_update=True, populate_existing=True)
    assert emp is not None
    _ensure_can_issue(emp)
    challenge = await otp.confirm_challenge(
        db, employee=emp, challenge_id=challenge_id, code=code, purpose=ChallengePurpose.key_issue
    )
    try:
        info = await crypto_service().create_key(owner_ref=str(emp.id))
    except CryptoServiceError as exc:
        await db.rollback()
        raise ApiError(status.HTTP_502_BAD_GATEWAY, exc.code, "Сервис электронной подписи недоступен") from exc
    now = datetime.now(timezone.utc)
    key = HrSigningKey(
        employee_id=emp.id,
        crypto_key_id=info.key_id,
        public_key=info.public_key,
        fingerprint=storage.streebog256_hex(info.public_key),
        algorithm=info.algorithm,
        phone_e164_at_issue=emp.phone_e164 or "",
        issued_at=now,
        issued_by_consent_doc_id=emp.edo_consent_doc_id,
        is_test=info.is_test,
    )
    db.add(key)
    await db.flush()
    emp.active_key_id = key.id
    emp.edo_status = EdoStatus.active
    emp.phone_verified_at = now
    await record_event(
        db,
        kind=HrEventKind.key_issued,
        actor=actor,
        employee_id=emp.id,
        payload={
            "keyId": str(key.id),
            "fingerprint": key.fingerprint,
            "algorithm": key.algorithm,
            "challengeId": str(challenge.id),
            "phone": challenge.phone_masked,
            "consentDocId": str(emp.edo_consent_doc_id),
            "isTest": key.is_test,
        },
    )
    await db.commit()
    await db.refresh(key)
    await notify.email_key_issued(
        to=emp.email,
        full_name=emp.full_name,
        fingerprint=key.fingerprint,
        issued_at=rendering.datetime_msk(key.issued_at),
    )
    return key
