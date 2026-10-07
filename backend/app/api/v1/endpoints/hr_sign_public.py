"""Публичный портал подписания кадровых документов — /sign/*.

Без JWT CRM: аутстафф-специалисты работают по ссылке из письма + SMS-код.
После входа — httpOnly-cookie `hr_sign_session` (30 минут, скользящее окно).
В openapi не документируется (как webhook Telegram): контракт описан в
docs/plan-hr-edo.md и в `frontend/src/api/hrSign.ts`.

Все ответы — `ApiError` (`{code, message, details}`), как во всём API.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.hr_edo import (
    _employee_actor,
    _redis_dep,
    challenge_dto,
    ensure_enabled,
    pdf_response,
)
from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.session import get_db
from app.integrations.sms import mask_phone
from app.modules.hr_edo import dto, keys, otp, portal, signing
from app.modules.hr_edo.evidence import record_event
from app.modules.hr_edo.models import (
    ChallengePurpose,
    HrEmployee,
    HrEmployeeStatus,
    HrEventKind,
)
from app.modules.hr_edo.schemas import (
    ChallengeConfirmRequest,
    ChallengeDto,
    ConfirmCodeRequest,
    CreateSignChallengeRequest,
    EmployeeSelfDto,
    PortalDocumentDto,
    PortalLinkInfoDto,
    ReasonRequest,
    SigningKeyDto,
    SignResultDto,
    ViewedRequest,
)

router = APIRouter(
    prefix="/sign",
    tags=["hr-sign"],
    include_in_schema=False,
    dependencies=[Depends(ensure_enabled)],
)

_LINK_OPENED_DEBOUNCE = timedelta(minutes=30)


def _cookie_path() -> str:
    return get_settings().api_v1_prefix + "/sign"


def _short_name(full_name: str) -> str:
    """«Иванов Иван Иванович» → «Иван И.» — минимум ПДн до входа по SMS."""
    parts = full_name.split()
    if len(parts) >= 2:
        return f"{parts[1]} {parts[0][0]}."
    return parts[0] if parts else ""


async def session_employee(
    request: Request,
    hr_sign_session: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> HrEmployee:
    employee_id, _token_id, phone_tag = await portal.read_session(redis, hr_sign_session)
    emp = await db.get(HrEmployee, employee_id)
    if (
        emp is None
        or emp.status != HrEmployeeStatus.active
        or not portal.session_matches_phone(phone_tag, emp.phone_e164)
    ):
        await portal.close_session(redis, hr_sign_session)
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "portal_session_expired", "Сессия недействительна — войдите заново")
    return emp


# ── Вход ────────────────────────────────────────────────────────────────────


@router.get("/session", response_model=EmployeeSelfDto)
async def session_info(
    emp: HrEmployee = Depends(session_employee), db: AsyncSession = Depends(get_db)
) -> EmployeeSelfDto:
    return await dto.employee_self_dto(db, emp)


@router.post("/session/logout")
async def logout(
    response: Response,
    hr_sign_session: str | None = Cookie(default=None),
    redis: Redis = Depends(_redis_dep),
) -> dict[str, bool]:
    await portal.close_session(redis, hr_sign_session)
    response.delete_cookie("hr_sign_session", path=_cookie_path())
    return {"ok": True}


@router.get("/{token}", response_model=PortalLinkInfoDto)
async def link_info(token: str, request: Request, db: AsyncSession = Depends(get_db)) -> PortalLinkInfoDto:
    tok, emp = await portal.resolve_token(db, token)
    now = datetime.now(timezone.utc)
    if tok.last_used_at is None or now - tok.last_used_at > _LINK_OPENED_DEBOUNCE:
        tok.last_used_at = now
        await record_event(
            db, kind=HrEventKind.link_opened, actor=_employee_actor(emp, request, "portal"), employee_id=emp.id,
            payload={"tokenId": str(tok.id)},
        )
        await db.commit()
    return PortalLinkInfoDto(
        employee_name=_short_name(emp.full_name),
        company_name=get_settings().hr_edo_company_name,
        phone_masked=mask_phone(emp.phone_e164) if emp.phone_e164 else "",
        expires_at=tok.expires_at,
    )


@router.post("/{token}/login/otp", response_model=ChallengeDto)
async def login_otp(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> ChallengeDto:
    _tok, emp = await portal.resolve_token(db, token)
    issued = await otp.create_challenge(
        db, redis, employee=emp, purpose=ChallengePurpose.portal_login, actor=_employee_actor(emp, request, "portal")
    )
    await db.commit()
    return challenge_dto(issued)


@router.post("/{token}/login/verify", response_model=EmployeeSelfDto)
async def login_verify(
    token: str,
    payload: ChallengeConfirmRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> EmployeeSelfDto:
    tok, emp = await portal.resolve_token(db, token)
    ch = await otp.confirm_challenge(
        db, employee=emp, challenge_id=payload.challenge_id, code=payload.code, purpose=ChallengePurpose.portal_login
    )
    tok.last_used_at = datetime.now(timezone.utc)
    await record_event(
        db, kind=HrEventKind.portal_login, actor=_employee_actor(emp, request, "portal"), employee_id=emp.id,
        payload={"tokenId": str(tok.id), "challengeId": str(ch.id), "phone": ch.phone_masked},
    )
    await db.commit()
    raw = await portal.open_session(redis, employee_id=emp.id, token_id=tok.id, phone=emp.phone_e164)
    settings = get_settings()
    response.set_cookie(
        key=portal.SESSION_COOKIE,
        value=raw,
        max_age=portal.session_ttl_seconds(),
        httponly=True,
        secure=settings.env != "dev",
        samesite="lax",
        path=_cookie_path(),
    )
    return await dto.employee_self_dto(db, emp)


# ── Ключ ────────────────────────────────────────────────────────────────────


@router.post("/session/key/otp", response_model=ChallengeDto)
async def key_otp(
    request: Request,
    emp: HrEmployee = Depends(session_employee),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> ChallengeDto:
    issued = await keys.request_key_otp(db, redis, emp, actor=_employee_actor(emp, request, "portal"))
    return challenge_dto(issued)


@router.post("/session/key/issue", response_model=SigningKeyDto)
async def key_issue(
    payload: ChallengeConfirmRequest,
    request: Request,
    emp: HrEmployee = Depends(session_employee),
    db: AsyncSession = Depends(get_db),
) -> SigningKeyDto:
    key = await keys.issue_key(
        db, emp, challenge_id=payload.challenge_id, code=payload.code, actor=_employee_actor(emp, request, "portal")
    )
    result = dto.key_dto(key)
    assert result is not None
    return result


# ── Документы ───────────────────────────────────────────────────────────────


@router.get("/session/documents", response_model=list[PortalDocumentDto])
async def documents(
    emp: HrEmployee = Depends(session_employee), db: AsyncSession = Depends(get_db)
) -> list[PortalDocumentDto]:
    docs = await signing.list_employee_documents(db, emp)
    return await dto.portal_documents_dto(db, emp, docs)


@router.get("/session/documents/{document_id}/file")
async def document_file(
    document_id: uuid.UUID, emp: HrEmployee = Depends(session_employee), db: AsyncSession = Depends(get_db)
) -> Response:
    data, name = await signing.employee_file(db, emp, document_id)
    return pdf_response(data, name)


@router.post("/session/documents/{document_id}/viewed", response_model=PortalDocumentDto)
async def viewed(
    document_id: uuid.UUID,
    payload: ViewedRequest,
    request: Request,
    emp: HrEmployee = Depends(session_employee),
    db: AsyncSession = Depends(get_db),
) -> PortalDocumentDto:
    doc = await signing.mark_viewed(db, emp, document_id, to_end=payload.to_end, actor=_employee_actor(emp, request, "portal"))
    return (await dto.portal_documents_dto(db, emp, [doc]))[0]


@router.post("/session/documents/{document_id}/reject", response_model=PortalDocumentDto)
async def reject(
    document_id: uuid.UUID,
    payload: ReasonRequest,
    request: Request,
    emp: HrEmployee = Depends(session_employee),
    db: AsyncSession = Depends(get_db),
) -> PortalDocumentDto:
    doc = await signing.reject(db, emp, document_id, reason=payload.reason, actor=_employee_actor(emp, request, "portal"))
    return (await dto.portal_documents_dto(db, emp, [doc]))[0]


@router.post("/session/challenges", response_model=ChallengeDto)
async def create_challenge(
    payload: CreateSignChallengeRequest,
    request: Request,
    emp: HrEmployee = Depends(session_employee),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> ChallengeDto:
    issued = await signing.request_sign_challenge(
        db, redis, emp, document_ids=payload.document_ids, actor=_employee_actor(emp, request, "portal")
    )
    return challenge_dto(issued)


@router.post("/session/challenges/{challenge_id}/confirm", response_model=SignResultDto)
async def confirm(
    challenge_id: uuid.UUID,
    payload: ConfirmCodeRequest,
    request: Request,
    emp: HrEmployee = Depends(session_employee),
    db: AsyncSession = Depends(get_db),
) -> SignResultDto:
    docs = await signing.confirm_and_sign(
        db, emp, challenge_id=challenge_id, code=payload.code, actor=_employee_actor(emp, request, "portal")
    )
    return SignResultDto(signed=[d.id for d in docs], documents=await dto.portal_documents_dto(db, emp, docs))
