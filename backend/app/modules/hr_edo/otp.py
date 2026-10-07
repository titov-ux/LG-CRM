"""Одноразовые SMS-коды кадрового ЭДО.

Параметры (они же прописываются в соглашении об УНЭП):

| параметр | значение |
|---|---|
| длина | 6 цифр, `secrets.randbelow` |
| срок жизни | 5 минут |
| попыток на код | 5, затем `locked` |
| повторная отправка | не чаще раза в 60 с |
| лимиты | 5 SMS в час и 15 в сутки на сотрудника; 30 в час на IP (Redis) |
| хранение | HMAC-SHA256, `hmac.compare_digest` |
| привязка | код действует только для своего набора хешей и своего `purpose` |

Код в открытом виде существует только в памяти процесса до отправки SMS:
в БД — HMAC, в логах и Sentry — маска.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import status
from redis.asyncio import Redis
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.integrations.sms import mask_phone, sms_provider
from app.modules.hr_edo.evidence import Actor, record_event
from app.modules.hr_edo.models import (
    ChallengePurpose,
    ChallengeStatus,
    HrEmployee,
    HrEventKind,
    HrSignChallenge,
)

CODE_LENGTH = 6
CODE_TTL = timedelta(minutes=5)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN_S = 60
LIMIT_PER_EMPLOYEE_HOUR = 5
LIMIT_PER_EMPLOYEE_DAY = 15
LIMIT_PER_IP_HOUR = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_code() -> str:
    return f"{secrets.randbelow(10**CODE_LENGTH):0{CODE_LENGTH}d}"


def code_hmac(challenge_id: uuid.UUID, code: str) -> str:
    secret = get_settings().hr_edo_otp_secret.encode()
    return hmac.new(secret, f"{challenge_id}:{code}".encode(), hashlib.sha256).hexdigest()


def digests_hash(digests: Sequence[str]) -> str:
    return hashlib.sha256("|".join(sorted(digests)).encode()).hexdigest()


def _webotp_domain() -> str:
    host = urlparse(get_settings().app_base_url).hostname
    return host or "localhost"


def build_sms_text(purpose: ChallengePurpose, code: str, subject: str | None) -> str:
    company = get_settings().hr_edo_company_short
    if purpose == ChallengePurpose.sign:
        action = f"подписание {subject}" if subject else "подписание документов"
    elif purpose == ChallengePurpose.key_issue:
        action = "выпуск электронной подписи"
    else:
        action = "вход в кадровые документы"
    # Последняя строка — формат WebOTP: браузер подставит код автоматически.
    return (
        f"Код {code} — {action}, {company}. Никому не сообщайте.\n\n"
        f"@{_webotp_domain()} #{code}"
    )


async def _hit(redis: Redis, key: str, ttl: int) -> int:
    count = int(await redis.incr(key))
    if count == 1:
        await redis.expire(key, ttl)
    return count


async def _check_limits(redis: Redis, employee_id: uuid.UUID, purpose: ChallengePurpose, ip: str | None) -> None:
    cooldown_key = f"hr_edo:otp:cooldown:{employee_id}:{purpose.value}"
    if not await redis.set(cooldown_key, "1", ex=RESEND_COOLDOWN_S, nx=True):
        ttl = max(int(await redis.ttl(cooldown_key)), 1)
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "otp_cooldown",
            f"Новый код можно запросить через {ttl} с",
            details={"retryAfter": ttl},
        )
    hour = await _hit(redis, f"hr_edo:otp:h:{employee_id}", 3600)
    day = await _hit(redis, f"hr_edo:otp:d:{employee_id}", 86400)
    by_ip = await _hit(redis, f"hr_edo:otp:ip:{ip}", 3600) if ip else 0
    if hour > LIMIT_PER_EMPLOYEE_HOUR or day > LIMIT_PER_EMPLOYEE_DAY or by_ip > LIMIT_PER_IP_HOUR:
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "otp_rate_limited",
            "Слишком много запросов кода. Попробуйте позже или обратитесь к кадровику.",
        )


@dataclass(frozen=True)
class IssuedChallenge:
    challenge: HrSignChallenge
    resend_after: int


async def create_challenge(
    db: AsyncSession,
    redis: Redis,
    *,
    employee: HrEmployee,
    purpose: ChallengePurpose,
    actor: Actor,
    document_ids: Sequence[uuid.UUID] = (),
    digests: Sequence[str] = (),
    subject: str | None = None,
) -> IssuedChallenge:
    """Создать челлендж и отправить SMS. Коммит — на вызывающей стороне."""
    if not employee.phone_e164:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "phone_missing",
            "У сотрудника не указан номер телефона",
        )
    await _check_limits(redis, employee.id, purpose, actor.ip)

    # Предыдущие коды того же назначения больше не действуют.
    await db.execute(
        update(HrSignChallenge)
        .where(
            HrSignChallenge.employee_id == employee.id,
            HrSignChallenge.purpose == purpose,
            HrSignChallenge.status == ChallengeStatus.pending,
        )
        .values(status=ChallengeStatus.superseded)
    )

    challenge_id = uuid.uuid4()
    code = generate_code()
    phone_masked = mask_phone(employee.phone_e164)
    ch = HrSignChallenge(
        id=challenge_id,
        employee_id=employee.id,
        purpose=purpose,
        document_ids=list(document_ids),
        digests_hash=digests_hash(digests) if digests else None,
        code_hmac=code_hmac(challenge_id, code),
        phone_masked=phone_masked,
        expires_at=_now() + CODE_TTL,
        attempts=0,
        max_attempts=MAX_ATTEMPTS,
        status=ChallengeStatus.pending,
        created_ip=actor.ip,
        created_at=_now(),
    )
    db.add(ch)
    await db.flush()

    result = await sms_provider().send(
        phone=employee.phone_e164, text=build_sms_text(purpose, code, subject)
    )
    del code  # дальше код не нужен и нигде не должен всплыть
    ch.sms_provider_id = result.provider_id
    ch.sms_delivery_status = result.status

    payload = {
        "challengeId": str(challenge_id),
        "purpose": purpose.value,
        "phone": phone_masked,
        "documentIds": [str(d) for d in document_ids],
    }
    if result.status == "failed":
        await record_event(
            db, kind=HrEventKind.otp_failed, actor=actor, employee_id=employee.id,
            payload={**payload, "error": result.error},
        )
        await db.commit()
        raise ApiError(
            status.HTTP_502_BAD_GATEWAY,
            "sms_failed",
            "Не удалось отправить SMS. Попробуйте ещё раз через минуту.",
        )
    await record_event(
        db, kind=HrEventKind.otp_sent, actor=actor, employee_id=employee.id, payload=payload
    )
    return IssuedChallenge(challenge=ch, resend_after=RESEND_COOLDOWN_S)


async def confirm_challenge(
    db: AsyncSession,
    *,
    employee: HrEmployee,
    challenge_id: uuid.UUID,
    code: str,
    purpose: ChallengePurpose,
) -> HrSignChallenge:
    """Проверить код. Неудачные попытки коммитятся до выброса ошибки."""
    ch = await db.get(HrSignChallenge, challenge_id, with_for_update=True)
    if ch is None or ch.employee_id != employee.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Код не найден")
    if ch.purpose != purpose:
        # Код входа не подходит для подписи и наоборот.
        raise ApiError(status.HTTP_409_CONFLICT, "otp_purpose_mismatch", "Код выдан для другой операции")
    if ch.status == ChallengeStatus.locked:
        raise ApiError(status.HTTP_423_LOCKED, "otp_locked", "Превышено число попыток. Запросите новый код.")
    if ch.status != ChallengeStatus.pending:
        raise ApiError(status.HTTP_409_CONFLICT, "otp_used", "Код уже использован или заменён новым")
    if ch.expires_at <= _now():
        ch.status = ChallengeStatus.expired
        await db.commit()
        raise ApiError(status.HTTP_410_GONE, "otp_expired", "Срок действия кода истёк. Запросите новый.")

    candidate = (code or "").strip()
    if not hmac.compare_digest(code_hmac(ch.id, candidate), ch.code_hmac):
        ch.attempts += 1
        left = ch.max_attempts - ch.attempts
        if left <= 0:
            ch.status = ChallengeStatus.locked
        await db.commit()
        if left <= 0:
            raise ApiError(status.HTTP_423_LOCKED, "otp_locked", "Превышено число попыток. Запросите новый код.")
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "otp_invalid",
            "Неверный код",
            details={"attemptsLeft": left},
        )
    ch.status = ChallengeStatus.confirmed
    ch.confirmed_at = _now()
    await db.flush()
    return ch
