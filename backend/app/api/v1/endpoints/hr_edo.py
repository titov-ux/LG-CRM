"""Эндпоинты /hr-edo — кадровый электронный документооборот.

* Кадровик (`hr_edo:manage` — по умолчанию администратор и бухгалтер):
  реестр сотрудников, согласие, документы, протокол.
* Директор (`hr_edo:sign_employer`): загрузка УКЭП работодателя.
* Выгрузка подписей (`hr_edo:export`).
* Сотрудник — пользователь CRM (`hr_edo:view_own`): `/hr-edo/my/*`, тот же
  сценарий подписи, что на публичном портале, но без SMS-входа.

Права — только через `permissions_service.require_action`. Чужие документы
без `hr_edo:manage` → 404.
"""
from __future__ import annotations

import ipaddress
import uuid
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from fastapi.responses import HTMLResponse, Response
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings, hr_edo_is_enabled
from app.core.errors import ApiError
from app.core.redis import get_redis
from app.db.session import get_db
from app.integrations.sms import DEV_SMS_OUTBOX
from app.modules.auth.dependencies import get_current_user
from app.modules.candidates.models import EmploymentType
from app.modules.hr_edo import dto, keys, service, signing
from app.modules.hr_edo.evidence import Actor, record_event, verify_chain
from app.modules.hr_edo.models import (
    EdoStatus,
    HrDocStatus,
    HrEmployee,
    HrEmployeeStatus,
    HrEventKind,
    SigType,
)
from app.modules.hr_edo.schemas import (
    ChainCheckDto,
    ChallengeConfirmRequest,
    ChallengeDto,
    ChangePhoneRequest,
    ConfirmCodeRequest,
    CreateDocumentsRequest,
    CreateEmployeeRequest,
    CreateSignChallengeRequest,
    DevSmsDto,
    DocTypeDto,
    HrDocumentDto,
    HrDocumentPage,
    HrEmployeeDto,
    HrEmployeePage,
    HrEventDto,
    HrEventPage,
    InviteResponse,
    MyOverviewDto,
    OptionalNoteRequest,
    PortalDocumentDto,
    PreviewRequest,
    ReasonRequest,
    SendDocumentsRequest,
    SendDocumentsResponse,
    SigningKeyDto,
    SignResultDto,
    UpdateDocumentRequest,
    UpdateEmployeeRequest,
    ViewedRequest,
)
from app.modules.permissions.service import require_action
from app.modules.users.models import User

router = APIRouter(prefix="/hr-edo", tags=["hr-edo"])


# ── Общие зависимости ───────────────────────────────────────────────────────


def ensure_enabled() -> None:
    if not hr_edo_is_enabled(get_settings()):
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "hr_edo_disabled",
            "Кадровый ЭДО не включён на этом контуре (HR_EDO_ENABLED)",
        )


def _redis_dep() -> Redis:
    return get_redis()


def client_ip(request: Request) -> str | None:
    """IP клиента для протокола и лимитов.

    За nginx доверяем `X-Real-IP` (его ставит сам прокси, `$remote_addr`) и
    ПОСЛЕДНЕМУ элементу `X-Forwarded-For` (дописан прокси). Левые элементы XFF
    присылает клиент — подделать ими IP в доказательной базе нельзя.
    """
    raw = (
        request.headers.get("X-Real-IP", "").strip()
        or request.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
        or (request.client.host if request.client else "")
    )
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return None


def user_agent(request: Request) -> str | None:
    ua = request.headers.get("User-Agent")
    return ua[:512] if ua else None


def actor_for(user: User, request: Request) -> Actor:
    return service.user_actor(user, client_ip(request), user_agent(request))


async def manager(
    _: None = Depends(ensure_enabled),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    await require_action(db, user, "hr_edo:manage", message="Раздел «Кадровые документы» доступен бухгалтеру и администратору")
    return user


async def employer_signer(
    _: None = Depends(ensure_enabled),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    await require_action(db, user, "hr_edo:sign_employer", message="Подписывать от имени работодателя может только директор")
    return user


async def exporter(
    _: None = Depends(ensure_enabled),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    await require_action(db, user, "hr_edo:export")
    return user


async def self_viewer(
    _: None = Depends(ensure_enabled),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    await require_action(db, user, "hr_edo:view_own")
    return user


def content_disposition(filename: str, *, inline: bool = True) -> str:
    ascii_fallback = filename.encode("ascii", errors="ignore").decode("ascii").strip() or "document.pdf"
    ascii_fallback = ascii_fallback.replace('"', "")
    kind = "inline" if inline else "attachment"
    return f"{kind}; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def pdf_response(data: bytes, filename: str, *, inline: bool = True) -> Response:
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": content_disposition(filename, inline=inline),
            "Cache-Control": "no-store",
        },
    )


async def _read_upload(file: UploadFile) -> tuple[bytes, str, str]:
    data = await file.read()
    name = file.filename or "file"
    mime = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    return data, name, mime


# ── Справочник ──────────────────────────────────────────────────────────────


@router.get("/doc-types", response_model=list[DocTypeDto], summary="Матрица типов документов (read-only)")
async def doc_types(_: None = Depends(ensure_enabled), __: User = Depends(get_current_user)) -> list[DocTypeDto]:
    return dto.all_doc_types()


# ── Сотрудники ──────────────────────────────────────────────────────────────


@router.get("/employees", response_model=HrEmployeePage, summary="Реестр сотрудников КЭДО")
async def list_employees(
    q: str | None = None,
    edo_status: EdoStatus | None = Query(default=None, alias="edoStatus"),
    employment_type: EmploymentType | None = Query(default=None, alias="employmentType"),
    status_: HrEmployeeStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500, alias="pageSize"),
    _: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEmployeePage:
    rows, total = await service.list_employees(
        db, q=q, edo_status=edo_status, employment_type=employment_type, status_=status_, page=page, page_size=page_size
    )
    return HrEmployeePage(items=await dto.employees_dto(db, rows), total=total, page=page, page_size=page_size)


@router.post("/employees", response_model=HrEmployeeDto, status_code=status.HTTP_201_CREATED, summary="Завести сотрудника")
async def create_employee(
    payload: CreateEmployeeRequest,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEmployeeDto:
    emp = await service.create_employee(db, payload, created_by=user, actor=actor_for(user, request))
    return await dto.employee_dto(db, emp)


@router.post(
    "/employees/from-candidate/{candidate_id}",
    response_model=HrEmployeeDto,
    status_code=status.HTTP_201_CREATED,
    summary="Оформить сотрудника из кандидата (статус hired)",
)
async def create_from_candidate(
    candidate_id: uuid.UUID,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEmployeeDto:
    emp = await service.create_from_candidate(db, candidate_id, created_by=user, actor=actor_for(user, request))
    return await dto.employee_dto(db, emp)


@router.get("/employees/{employee_id}", response_model=HrEmployeeDto, summary="Карточка сотрудника")
async def get_employee(
    employee_id: uuid.UUID, _: User = Depends(manager), db: AsyncSession = Depends(get_db)
) -> HrEmployeeDto:
    return await dto.employee_dto(db, await service.get_employee(db, employee_id))


@router.patch("/employees/{employee_id}", response_model=HrEmployeeDto, summary="Изменить карточку сотрудника")
async def update_employee(
    employee_id: uuid.UUID,
    payload: UpdateEmployeeRequest,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEmployeeDto:
    emp = await service.update_employee(db, employee_id, payload, actor=actor_for(user, request))
    return await dto.employee_dto(db, emp)


@router.post("/employees/{employee_id}/invite", response_model=InviteResponse, summary="Пригласить в КЭДО (пакет согласия)")
async def invite(
    employee_id: uuid.UUID,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> InviteResponse:
    emp, doc, sent, url = await service.invite(db, employee_id, user=user, actor=actor_for(user, request))
    return InviteResponse(
        employee=await dto.employee_dto(db, emp),
        document=await dto.document_dto(db, doc),
        email_sent=sent,
        portal_url=url,
    )


@router.post("/employees/{employee_id}/consent", response_model=HrEmployeeDto, summary="Зарегистрировать подписанное согласие")
async def register_consent(
    employee_id: uuid.UUID,
    request: Request,
    sig_type: SigType = Form(alias="sigType"),
    note: str | None = Form(default=None),
    file: UploadFile = File(...),
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEmployeeDto:
    data, name, mime = await _read_upload(file)
    emp = await service.register_consent(
        db, employee_id, sig_type=sig_type, data=data, filename=name, mime=mime, note=note,
        user=user, actor=actor_for(user, request),
    )
    return await dto.employee_dto(db, emp)


@router.post("/employees/{employee_id}/refuse", response_model=HrEmployeeDto, summary="Отказ от КЭДО — бумажный контур")
async def refuse(
    employee_id: uuid.UUID,
    payload: OptionalNoteRequest,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEmployeeDto:
    emp = await service.refuse_edo(db, employee_id, note=payload.note, actor=actor_for(user, request))
    return await dto.employee_dto(db, emp)


@router.post("/employees/{employee_id}/keys/revoke", response_model=HrEmployeeDto, summary="Отозвать ключ УНЭП")
async def revoke_key(
    employee_id: uuid.UUID,
    payload: ReasonRequest,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEmployeeDto:
    emp = await service.revoke_key(db, employee_id, reason=payload.reason, actor=actor_for(user, request))
    return await dto.employee_dto(db, emp)


@router.post("/employees/{employee_id}/phone", response_model=HrEmployeeDto, summary="Сменить телефон (с отзывом ключа)")
async def change_phone(
    employee_id: uuid.UUID,
    payload: ChangePhoneRequest,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEmployeeDto:
    emp = await service.change_phone(
        db, employee_id, phone=payload.phone, reason=payload.reason, actor=actor_for(user, request)
    )
    return await dto.employee_dto(db, emp)


# ── Документы ───────────────────────────────────────────────────────────────


@router.get("/documents", response_model=HrDocumentPage, summary="Кадровые документы")
async def list_documents(
    q: str | None = None,
    status_: HrDocStatus | None = Query(default=None, alias="status"),
    type_code: str | None = Query(default=None, alias="typeCode"),
    employee_id: uuid.UUID | None = Query(default=None, alias="employeeId"),
    awaiting_employer: bool | None = Query(default=None, alias="awaitingEmployer"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500, alias="pageSize"),
    _: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrDocumentPage:
    rows, total = await service.list_documents(
        db, q=q, status_=status_, type_code=type_code, employee_id=employee_id,
        awaiting_employer=awaiting_employer, page=page, page_size=page_size,
    )
    return HrDocumentPage(items=await dto.documents_dto(db, rows), total=total, page=page, page_size=page_size)


@router.post(
    "/documents",
    response_model=list[HrDocumentDto],
    status_code=status.HTTP_201_CREATED,
    summary="Создать документ(ы) по шаблону — по одному на сотрудника",
)
async def create_documents(
    payload: CreateDocumentsRequest,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> list[HrDocumentDto]:
    docs = await service.create_documents(db, payload, user=user, actor=actor_for(user, request))
    return await dto.documents_dto(db, docs)


@router.post("/documents/preview", response_class=HTMLResponse, summary="HTML-предпросмотр по шаблону")
async def preview(
    payload: PreviewRequest, _: User = Depends(manager), db: AsyncSession = Depends(get_db)
) -> HTMLResponse:
    return HTMLResponse(await service.render_preview(db, payload))


@router.post(
    "/documents/upload",
    response_model=HrDocumentDto,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить готовый PDF (upload_only) или скан бумажного (paper_only)",
)
async def upload_document(
    request: Request,
    employee_id: uuid.UUID = Form(alias="employeeId"),
    type_code: str = Form(alias="typeCode"),
    title: str | None = Form(default=None),
    doc_date: date | None = Form(default=None, alias="docDate"),
    file: UploadFile = File(...),
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrDocumentDto:
    data, name, mime = await _read_upload(file)
    doc = await service.upload_document(
        db, employee_id=employee_id, type_code=type_code, title=title, doc_date=doc_date,
        data=data, filename=name, mime=mime, user=user, actor=actor_for(user, request),
    )
    return await dto.document_dto(db, doc)


@router.post("/documents/send", response_model=SendDocumentsResponse, summary="Отправить документы на подпись")
async def send_documents(
    payload: SendDocumentsRequest,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> SendDocumentsResponse:
    docs, links = await service.send_documents(db, payload.ids, user=user, actor=actor_for(user, request))
    return SendDocumentsResponse(items=await dto.documents_dto(db, docs), portal_links=links)


@router.get("/documents/{document_id}", response_model=HrDocumentDto, summary="Документ")
async def get_document(
    document_id: uuid.UUID, _: User = Depends(manager), db: AsyncSession = Depends(get_db)
) -> HrDocumentDto:
    return await dto.document_dto(db, await service.get_document(db, document_id))


@router.patch("/documents/{document_id}", response_model=HrDocumentDto, summary="Изменить черновик")
async def update_document(
    document_id: uuid.UUID,
    payload: UpdateDocumentRequest,
    _: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrDocumentDto:
    return await dto.document_dto(db, await service.update_draft(db, document_id, payload))


@router.get("/documents/{document_id}/preview", response_class=HTMLResponse, summary="HTML документа по шаблону")
async def document_preview(
    document_id: uuid.UUID, _: User = Depends(manager), db: AsyncSession = Depends(get_db)
) -> HTMLResponse:
    doc = await service.get_document(db, document_id)
    return HTMLResponse(await service.render_document_preview(db, doc))


@router.post("/documents/{document_id}/freeze", response_model=HrDocumentDto, summary="Сформировать PDF и заморозить")
async def freeze(
    document_id: uuid.UUID, request: Request, user: User = Depends(manager), db: AsyncSession = Depends(get_db)
) -> HrDocumentDto:
    doc = await service.freeze_document(db, document_id, user=user, actor=actor_for(user, request))
    return await dto.document_dto(db, doc)


@router.post("/documents/{document_id}/send", response_model=SendDocumentsResponse, summary="Отправить сотруднику")
async def send_one(
    document_id: uuid.UUID, request: Request, user: User = Depends(manager), db: AsyncSession = Depends(get_db)
) -> SendDocumentsResponse:
    docs, links = await service.send_documents(db, [document_id], user=user, actor=actor_for(user, request))
    return SendDocumentsResponse(items=await dto.documents_dto(db, docs), portal_links=links)


@router.post("/documents/{document_id}/remind", response_model=SendDocumentsResponse, summary="Напомнить сотруднику")
async def remind(
    document_id: uuid.UUID, request: Request, user: User = Depends(manager), db: AsyncSession = Depends(get_db)
) -> SendDocumentsResponse:
    doc, url = await service.remind(db, document_id, user=user, actor=actor_for(user, request))
    links = {str(doc.employee_id): url} if url else {}
    return SendDocumentsResponse(items=await dto.documents_dto(db, [doc]), portal_links=links)


@router.post("/documents/{document_id}/cancel", response_model=HrDocumentDto, summary="Отменить документ")
async def cancel(
    document_id: uuid.UUID,
    payload: ReasonRequest,
    request: Request,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrDocumentDto:
    doc = await service.cancel_document(db, document_id, reason=payload.reason, actor=actor_for(user, request))
    return await dto.document_dto(db, doc)


@router.post(
    "/documents/{document_id}/employer-signature",
    response_model=HrDocumentDto,
    summary="Загрузить УКЭП директора (.sig, Этап 1)",
)
async def employer_signature(
    document_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(employer_signer),
    db: AsyncSession = Depends(get_db),
) -> HrDocumentDto:
    data, name, _mime = await _read_upload(file)
    doc = await service.employer_signature(
        db, document_id, data=data, filename=name, user=user, actor=actor_for(user, request)
    )
    return await dto.document_dto(db, doc)


@router.post(
    "/documents/{document_id}/paper-signed",
    response_model=HrDocumentDto,
    summary="Отметить подписанным на бумаге (скан оригинала)",
)
async def paper_signed(
    document_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrDocumentDto:
    data, name, mime = await _read_upload(file)
    doc = await service.paper_signed(
        db, document_id, data=data, filename=name, mime=mime, user=user, actor=actor_for(user, request)
    )
    return await dto.document_dto(db, doc)


@router.get("/documents/{document_id}/file", summary="PDF документа (исходник или с листом подписания)")
async def document_file(
    document_id: uuid.UUID,
    request: Request,
    kind: str = Query(default="source", pattern="^(source|stamped)$"),
    download: bool = False,
    user: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> Response:
    doc = await service.get_document(db, document_id)
    data, name = await service.document_file(db, doc, kind=kind)
    if download:
        await record_event(
            db, kind=HrEventKind.downloaded, actor=actor_for(user, request), document_id=doc.id,
            employee_id=doc.employee_id, payload={"kind": kind},
        )
        await db.commit()
    return pdf_response(data, name, inline=not download)


@router.get("/documents/{document_id}/signatures/{signature_id}/file", summary="Файл подписи (.sig) или скан")
async def signature_file(
    document_id: uuid.UUID,
    signature_id: uuid.UUID,
    request: Request,
    user: User = Depends(exporter),
    db: AsyncSession = Depends(get_db),
) -> Response:
    doc = await service.get_document(db, document_id)
    data, name, mime = await service.signature_file(db, doc, signature_id)
    await record_event(
        db, kind=HrEventKind.exported, actor=actor_for(user, request), document_id=doc.id,
        employee_id=doc.employee_id, payload={"signatureId": str(signature_id)},
    )
    await db.commit()
    return Response(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": content_disposition(name, inline=False), "Cache-Control": "no-store"},
    )


def _event_dto(ev, title: str | None, name: str | None) -> HrEventDto:  # type: ignore[no-untyped-def]
    return HrEventDto(
        id=ev.id,
        document_id=ev.document_id,
        document_title=title,
        employee_id=ev.employee_id,
        employee_name=name,
        kind=ev.kind.value,
        actor_type=ev.actor_type,
        actor_name=ev.actor_name,
        ip=ev.ip,
        payload=dict(ev.payload or {}),
        created_at=ev.created_at,
        hash=ev.hash,
        prev_hash=ev.prev_hash,
    )


@router.get("/documents/{document_id}/events", response_model=list[HrEventDto], summary="Протокол документа")
async def document_events(
    document_id: uuid.UUID, _: User = Depends(manager), db: AsyncSession = Depends(get_db)
) -> list[HrEventDto]:
    await service.get_document(db, document_id)
    rows, _total = await service.list_events(
        db, document_id=document_id, employee_id=None, kind=None, page=1, page_size=1000
    )
    return [_event_dto(ev, t, n) for ev, t, n in rows]


@router.get("/events", response_model=HrEventPage, summary="Журнал кадрового ЭДО")
async def list_events(
    document_id: uuid.UUID | None = Query(default=None, alias="documentId"),
    employee_id: uuid.UUID | None = Query(default=None, alias="employeeId"),
    kind: HrEventKind | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500, alias="pageSize"),
    _: User = Depends(manager),
    db: AsyncSession = Depends(get_db),
) -> HrEventPage:
    rows, total = await service.list_events(
        db, document_id=document_id, employee_id=employee_id, kind=kind, page=page, page_size=page_size
    )
    return HrEventPage(items=[_event_dto(ev, t, n) for ev, t, n in rows], total=total, page=page, page_size=page_size)


@router.get("/events/verify", response_model=ChainCheckDto, summary="Сверка хеш-цепочки протокола")
async def verify_events(_: User = Depends(manager), db: AsyncSession = Depends(get_db)) -> ChainCheckDto:
    res = await verify_chain(db)
    return ChainCheckDto(ok=res.ok, checked=res.checked, broken_at_id=res.broken_at_id, reason=res.reason)


# ── Dev: SMS-outbox ─────────────────────────────────────────────────────────


@router.get("/dev/sms-outbox", response_model=list[DevSmsDto], summary="(dev) последние SMS режима log")
async def dev_sms_outbox(_: User = Depends(manager)) -> list[DevSmsDto]:
    settings = get_settings()
    if settings.env != "dev" or settings.sms_provider != "log":
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Недоступно")
    return [DevSmsDto(phone=m.phone, text=m.text, sent_at=m.sent_at) for m in DEV_SMS_OUTBOX]


# ════════════════════════════════════════════════════════════════════════════
# «Мои документы» — сотрудник-пользователь CRM
# ════════════════════════════════════════════════════════════════════════════


async def _my_employee(db: AsyncSession, user: User) -> HrEmployee:
    emp = (await db.execute(select(HrEmployee).where(HrEmployee.user_id == user.id))).scalar_one_or_none()
    if emp is None or emp.status != HrEmployeeStatus.active:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "employee_not_linked",
            "Ваш аккаунт не привязан к карточке сотрудника в кадровом ЭДО",
        )
    return emp


def _employee_actor(emp: HrEmployee, request: Request, channel: str) -> Actor:
    return Actor(
        type="employee",
        name=emp.full_name,
        employee_id=emp.id,
        ip=client_ip(request),
        ua=f"[{channel}] {user_agent(request) or ''}".strip(),
    )


def challenge_dto(issued) -> ChallengeDto:  # type: ignore[no-untyped-def]
    ch = issued.challenge
    return ChallengeDto(
        challenge_id=ch.id,
        phone_masked=ch.phone_masked,
        expires_at=ch.expires_at,
        resend_after=issued.resend_after,
        document_ids=list(ch.document_ids or []),
    )


@router.get("/my", response_model=MyOverviewDto, summary="Мой статус в КЭДО")
async def my_overview(user: User = Depends(self_viewer), db: AsyncSession = Depends(get_db)) -> MyOverviewDto:
    emp = (await db.execute(select(HrEmployee).where(HrEmployee.user_id == user.id))).scalar_one_or_none()
    if emp is None or emp.status != HrEmployeeStatus.active:
        return MyOverviewDto(employee=None)
    return MyOverviewDto(employee=await dto.employee_self_dto(db, emp))


@router.get("/my/documents", response_model=list[PortalDocumentDto], summary="Мои кадровые документы")
async def my_documents(user: User = Depends(self_viewer), db: AsyncSession = Depends(get_db)) -> list[PortalDocumentDto]:
    emp = await _my_employee(db, user)
    docs = await signing.list_employee_documents(db, emp)
    return await dto.portal_documents_dto(db, emp, docs)


@router.get("/my/documents/{document_id}/file", summary="PDF моего документа")
async def my_document_file(
    document_id: uuid.UUID, user: User = Depends(self_viewer), db: AsyncSession = Depends(get_db)
) -> Response:
    emp = await _my_employee(db, user)
    data, name = await signing.employee_file(db, emp, document_id)
    return pdf_response(data, name)


@router.post("/my/documents/{document_id}/viewed", response_model=PortalDocumentDto, summary="Отметка просмотра")
async def my_viewed(
    document_id: uuid.UUID,
    payload: ViewedRequest,
    request: Request,
    user: User = Depends(self_viewer),
    db: AsyncSession = Depends(get_db),
) -> PortalDocumentDto:
    emp = await _my_employee(db, user)
    doc = await signing.mark_viewed(db, emp, document_id, to_end=payload.to_end, actor=_employee_actor(emp, request, "crm"))
    return (await dto.portal_documents_dto(db, emp, [doc]))[0]


@router.post("/my/documents/{document_id}/reject", response_model=PortalDocumentDto, summary="Отказаться подписывать")
async def my_reject(
    document_id: uuid.UUID,
    payload: ReasonRequest,
    request: Request,
    user: User = Depends(self_viewer),
    db: AsyncSession = Depends(get_db),
) -> PortalDocumentDto:
    emp = await _my_employee(db, user)
    doc = await signing.reject(db, emp, document_id, reason=payload.reason, actor=_employee_actor(emp, request, "crm"))
    return (await dto.portal_documents_dto(db, emp, [doc]))[0]


@router.post("/my/key/otp", response_model=ChallengeDto, summary="SMS-код для выпуска подписи")
async def my_key_otp(
    request: Request,
    user: User = Depends(self_viewer),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> ChallengeDto:
    emp = await _my_employee(db, user)
    issued = await keys.request_key_otp(db, redis, emp, actor=_employee_actor(emp, request, "crm"))
    return challenge_dto(issued)


@router.post("/my/key/issue", response_model=SigningKeyDto, summary="Выпустить подпись по коду из SMS")
async def my_key_issue(
    payload: ChallengeConfirmRequest,
    request: Request,
    user: User = Depends(self_viewer),
    db: AsyncSession = Depends(get_db),
) -> SigningKeyDto:
    emp = await _my_employee(db, user)
    key = await keys.issue_key(
        db, emp, challenge_id=payload.challenge_id, code=payload.code, actor=_employee_actor(emp, request, "crm")
    )
    result = dto.key_dto(key)
    assert result is not None
    return result


@router.post("/my/challenges", response_model=ChallengeDto, summary="SMS-код для подписи документов")
async def my_challenge(
    payload: CreateSignChallengeRequest,
    request: Request,
    user: User = Depends(self_viewer),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(_redis_dep),
) -> ChallengeDto:
    emp = await _my_employee(db, user)
    issued = await signing.request_sign_challenge(
        db, redis, emp, document_ids=payload.document_ids, actor=_employee_actor(emp, request, "crm")
    )
    return challenge_dto(issued)


@router.post("/my/challenges/{challenge_id}/confirm", response_model=SignResultDto, summary="Подписать кодом из SMS")
async def my_confirm(
    challenge_id: uuid.UUID,
    payload: ConfirmCodeRequest,
    request: Request,
    user: User = Depends(self_viewer),
    db: AsyncSession = Depends(get_db),
) -> SignResultDto:
    emp = await _my_employee(db, user)
    docs = await signing.confirm_and_sign(
        db, emp, challenge_id=challenge_id, code=payload.code, actor=_employee_actor(emp, request, "crm")
    )
    return SignResultDto(signed=[d.id for d in docs], documents=await dto.portal_documents_dto(db, emp, docs))
