"""Кадровый ЭДО (Этап 1): сквозной сценарий и инварианты безопасности.

Внешние зависимости подменены:
* S3 — in-memory (`storage.set_s3_for_tests`);
* SMS — провайдер, который запоминает последний код для номера;
* PDF — pypdf вместо Playwright (`rendering.set_pdf_renderer_for_tests`);
* crypto-service — `NoopCryptoService` (тот же контракт activation_token).

HTTP — через `httpx.AsyncClient` + ASGITransport в том же event loop, что и
фикстура `db` (TestClient гоняет приложение в своём потоке и loop, и asyncpg-
соединение транзакционной сессии оттуда недоступно).
"""
from __future__ import annotations

import io
import logging
import re
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from pypdf import PdfReader, PdfWriter
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1.endpoints import auth as auth_ep
from app.api.v1.endpoints import hr_edo as hr_ep
from app.core.redis import get_redis
from app.core.security import create_access_token
from app.db.session import get_db
from app.integrations import crypto_service as crypto_mod
from app.integrations.sms import SmsResult, set_sms_provider_for_tests
from app.main import app
from app.modules.candidates.models import Candidate, CandidateStatus
from app.modules.hr_edo import evidence, rendering, storage
from app.modules.hr_edo.models import HrDocEvent, HrDocument, HrSignChallenge
from app.modules.permissions.defaults import DEFAULT_PERMISSIONS
from app.modules.users.models import Role, User
from tests.conftest import _make_user

API = "/api/v1"


# ── Фейки ───────────────────────────────────────────────────────────────────


class MemS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def upload_bytes(self, *, file_key: str, data: bytes, mime: str) -> None:
        self.objects[file_key] = data

    def download_bytes(self, *, file_key: str) -> bytes:
        return self.objects[file_key]

    def presign_post(self, **_: object):  # pragma: no cover
        raise NotImplementedError

    def presign_get(self, **_: object) -> str:  # pragma: no cover
        raise NotImplementedError

    def delete(self, *, file_key: str) -> None:  # pragma: no cover
        self.objects.pop(file_key, None)


class CapturingSms:
    name = "test"

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send(self, *, phone: str, text: str) -> SmsResult:
        self.sent.append((phone, text))
        return SmsResult(provider_id=f"id-{len(self.sent)}", status="queued")

    async def status(self, *, provider_id: str, phone: str) -> str:
        return "delivered"

    def last_code(self) -> str:
        m = re.search(r"Код (\d{6})", self.sent[-1][1])
        assert m
        return m.group(1)


async def fake_pdf(html: str) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.add_metadata({"/Subject": str(len(html))})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.fixture(autouse=True)
def _fakes() -> Iterator[None]:
    s3 = MemS3()
    storage.set_s3_for_tests(s3)
    rendering.set_pdf_renderer_for_tests(fake_pdf)
    crypto_mod.set_crypto_service_for_tests(crypto_mod.NoopCryptoService())
    yield
    storage.set_s3_for_tests(None)
    rendering.set_pdf_renderer_for_tests(None)
    crypto_mod.set_crypto_service_for_tests(None)
    set_sms_provider_for_tests(None)


@pytest.fixture()
def sms() -> CapturingSms:
    provider = CapturingSms()
    set_sms_provider_for_tests(provider)
    return provider


@pytest_asyncio.fixture()
async def db(engine) -> AsyncIterator[AsyncSession]:
    """Как conftest.db, но commit/rollback сервиса работают через SAVEPOINT.

    Сервис кадрового ЭДО откатывает транзакцию запроса и пишет событие
    отдельной транзакцией (подмена файла). С обычной фикстурой rollback
    сервиса снёс бы всю внешнюю транзакцию теста.
    """
    conn = await engine.connect()
    trans = await conn.begin()
    factory = async_sessionmaker(
        bind=conn, expire_on_commit=False, class_=AsyncSession, join_transaction_mode="create_savepoint"
    )
    async with factory() as session:
        try:
            yield session
        finally:
            await session.close()
    await trans.rollback()
    await conn.close()


@pytest_asyncio.fixture()
async def http(db: AsyncSession, fake_redis) -> AsyncIterator[httpx.AsyncClient]:
    async def _db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_redis] = lambda: fake_redis
    app.dependency_overrides[auth_ep._redis_dep] = lambda: fake_redis
    app.dependency_overrides[hr_ep._redis_dep] = lambda: fake_redis
    transport = httpx.ASGITransport(app=app, client=("10.0.0.7", 5555))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def bearer(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


@pytest_asyncio.fixture()
async def accountant(db: AsyncSession) -> User:
    return await _make_user(db, "buh@lg.ru", "correct-horse-battery-staple", Role.accountant, True)


@pytest_asyncio.fixture()
async def employee_user(db: AsyncSession) -> User:
    return await _make_user(db, "worker@lg.ru", "correct-horse-battery-staple", Role.recruiter, True)


# ── Хелперы сценария ────────────────────────────────────────────────────────


async def create_employee(http: httpx.AsyncClient, hr: User, **extra: object) -> dict:
    body = {
        "fullName": "Петров Пётр Петрович",
        "position": "Java-разработчик",
        "phone": "8 (999) 123-45-67",
        "email": "petrov@example.com",
        **extra,
    }
    r = await http.post(f"{API}/hr-edo/employees", json=body, headers=bearer(hr))
    assert r.status_code == 201, r.text
    return r.json()


async def onboard(http: httpx.AsyncClient, hr: User, sms: CapturingSms, **extra: object) -> tuple[dict, str]:
    """Сотрудник → «Пригласить в КЭДО» → согласие зарегистрировано (скан).

    Возвращает сотрудника и ссылку из приглашения. Регистрация согласия
    выдаёт новую ссылку (старая отзывается) — для входа на портал тесты берут
    свежую через `fresh_token`.
    """
    emp = await create_employee(http, hr, **extra)
    r = await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(hr))
    assert r.status_code == 200, r.text
    invite = r.json()
    assert invite["employee"]["edoStatus"] == "notified"
    token = invite["portalUrl"].rsplit("/", 1)[-1]  # SMTP в тестах не настроен → ссылка в ответе

    r = await http.post(
        f"{API}/hr-edo/employees/{emp['id']}/consent",
        data={"sigType": "paper"},
        files={"file": ("consent.pdf", await fake_pdf("scan"), "application/pdf")},
        headers=bearer(hr),
    )
    assert r.status_code == 200, r.text
    assert r.json()["edoStatus"] == "consent_signed"
    return emp, token


async def portal_login(http: httpx.AsyncClient, token: str, sms: CapturingSms) -> None:
    r = await http.post(f"{API}/sign/{token}/login/otp")
    assert r.status_code == 200, r.text
    ch = r.json()
    r = await http.post(
        f"{API}/sign/{token}/login/verify", json={"challengeId": ch["challengeId"], "code": sms.last_code()}
    )
    assert r.status_code == 200, r.text
    assert "hr_sign_session" in r.cookies or http.cookies.get("hr_sign_session")


async def fresh_token(db: AsyncSession, employee_id: str) -> str:
    """Выдать ссылку напрямую сервисом (в проде она уходит письмом)."""
    from app.modules.hr_edo import portal
    from app.modules.hr_edo.models import HrEmployee

    emp = await db.get(HrEmployee, uuid.UUID(employee_id))
    assert emp is not None
    raw = await portal.issue_access_token(db, emp, created_by=None)
    await db.commit()
    return raw


async def issue_key_portal(http: httpx.AsyncClient, sms: CapturingSms) -> dict:
    r = await http.post(f"{API}/sign/session/key/otp")
    assert r.status_code == 200, r.text
    ch = r.json()
    r = await http.post(
        f"{API}/sign/session/key/issue", json={"challengeId": ch["challengeId"], "code": sms.last_code()}
    )
    assert r.status_code == 200, r.text
    return r.json()


async def make_contract_and_order(http: httpx.AsyncClient, hr: User, emp_id: str) -> list[dict]:
    fields = {
        "position": "Java-разработчик",
        "start_date": "2026-10-01",
        "contract_kind": "бессрочный",
        "salary": "250000",
        "work_place": "дистанционно",
        "work_schedule": "пятидневка",
        "contract_number": "ТД-2026-0001",
        "contract_date": "2026-09-29",
    }
    docs = []
    for code in ("employment_contract", "order_hire"):
        r = await http.post(
            f"{API}/hr-edo/documents",
            json={"typeCode": code, "employeeIds": [emp_id], "fields": fields, "freeze": True},
            headers=bearer(hr),
        )
        assert r.status_code == 201, r.text
        doc = r.json()[0]
        assert doc["status"] == "awaiting_employer"
        assert doc["contentSha256"] and doc["contentStreebog256"]
        docs.append(doc)
    return docs


async def read_to_end(http: httpx.AsyncClient, *doc_ids: str, prefix: str = "/sign/session", headers: dict | None = None) -> None:
    for d in doc_ids:
        r = await http.post(f"{API}{prefix}/documents/{d}/viewed", json={"toEnd": True}, headers=headers or {})
        assert r.status_code == 200, r.text


async def employer_sign(http: httpx.AsyncClient, admin: User, doc_id: str) -> dict:
    r = await http.post(
        f"{API}/hr-edo/documents/{doc_id}/employer-signature",
        files={"file": ("director.sig", b"\x30\x82fake-cades", "application/octet-stream")},
        headers=bearer(admin),
    )
    assert r.status_code == 200, r.text
    return r.json()


# ════════════════════════════════════════════════════════════════════════════
# Права
# ════════════════════════════════════════════════════════════════════════════


def test_default_matrix_hr_edo_manage_is_admin_and_accountant_only() -> None:
    rows = {p["id"]: p for p in DEFAULT_PERMISSIONS}
    manage = rows["hr_edo.manage"]["matrix"]
    assert manage == {
        "admin": True, "account_manager": False, "recruiter": False, "viewer": False, "accountant": True,
    }
    assert all(v for v in rows["hr_edo.view_own"]["matrix"].values())
    # Каждая строка матрицы знает про все 5 ролей.
    for p in DEFAULT_PERMISSIONS:
        assert set(p["matrix"]) == {r.value for r in Role}, p["id"]


async def test_recruiter_gets_403_with_action_details(http, recruiter_user) -> None:
    r = await http.get(f"{API}/hr-edo/employees", headers=bearer(recruiter_user))
    assert r.status_code == 403
    assert r.json()["detail"]["details"]["action"] == "hr_edo:manage"


async def test_accountant_and_admin_have_access(http, accountant, admin_user) -> None:
    for u in (accountant, admin_user):
        r = await http.get(f"{API}/hr-edo/employees", headers=bearer(u))
        assert r.status_code == 200, r.text


async def test_matrix_backfills_accountant_key_for_existing_rows(http, db, admin_user) -> None:
    from app.modules.permissions.models import PermissionRow

    # Строка «из старой БД» — без ключа accountant.
    db.add(
        PermissionRow(
            id="clients.view", group="Клиенты", permission="x", description="",
            actions=[], matrix={"admin": True, "account_manager": True, "recruiter": True, "viewer": True},
        )
    )
    await db.commit()
    r = await http.get(f"{API}/permissions-matrix", headers=bearer(admin_user))
    assert r.status_code == 200
    items = {i["id"]: i for i in r.json()["items"]}
    assert items["clients.view"]["matrix"]["accountant"] is True
    assert items["hr_edo.manage"]["matrix"]["accountant"] is True


async def test_hr_files_hidden_from_generic_files_api(http, db, accountant, sms) -> None:
    emp = await create_employee(http, accountant)
    await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(accountant))
    from app.modules.files.models import File, FileEntityType

    f = (await db.execute(select(File).where(File.entity_type == FileEntityType.hr_document))).scalars().first()
    assert f is not None
    r = await http.get(f"{API}/files/{f.id}/download", headers=bearer(accountant))
    assert r.status_code == 404
    r = await http.delete(f"{API}/files/{f.id}", headers=bearer(accountant))
    assert r.status_code == 409


# ════════════════════════════════════════════════════════════════════════════
# Сквозной сценарий Этапа 1
# ════════════════════════════════════════════════════════════════════════════


async def test_end_to_end_contract_and_order_signed_with_one_code(
    http, db, accountant, admin_user, sms, caplog
) -> None:
    caplog.set_level(logging.DEBUG)
    emp, _ = await onboard(http, accountant, sms)
    token = await fresh_token(db, emp["id"])
    await portal_login(http, token, sms)
    key = await issue_key_portal(http, sms)
    assert len(key["fingerprint"]) == 64 and key["isTest"] is True

    r = await http.get(f"{API}/hr-edo/employees/{emp['id']}", headers=bearer(accountant))
    assert r.json()["edoStatus"] == "active"
    assert r.json()["activeKey"]["fingerprint"] == key["fingerprint"]

    contract, order = await make_contract_and_order(http, accountant, emp["id"])
    # Отправить до подписи директора нельзя.
    r = await http.post(f"{API}/hr-edo/documents/send", json={"ids": [contract["id"]]}, headers=bearer(accountant))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "employer_signature_required"
    # Бухгалтер не директор: подпись работодателя — только admin.
    r = await http.post(
        f"{API}/hr-edo/documents/{contract['id']}/employer-signature",
        files={"file": ("d.sig", b"x", "application/octet-stream")},
        headers=bearer(accountant),
    )
    assert r.status_code == 403
    for d in (contract, order):
        assert (await employer_sign(http, admin_user, d["id"]))["status"] == "frozen"

    r = await http.post(
        f"{API}/hr-edo/documents/send", json={"ids": [contract["id"], order["id"]]}, headers=bearer(accountant)
    )
    assert r.status_code == 200, r.text
    assert {d["status"] for d in r.json()["items"]} == {"sent"}

    r = await http.get(f"{API}/sign/session/documents")
    docs = {d["id"]: d for d in r.json()}
    assert docs[contract["id"]]["canSign"] and docs[order["id"]]["canSign"]

    r = await http.get(f"{API}/sign/session/documents/{contract['id']}/file")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    for d in (contract, order):
        await http.post(f"{API}/sign/session/documents/{d['id']}/viewed", json={"toEnd": True})

    r = await http.post(f"{API}/sign/session/challenges", json={"documentIds": [contract["id"], order["id"]]})
    assert r.status_code == 200, r.text
    ch = r.json()
    assert "2 документов" in sms.sent[-1][1]
    r = await http.post(f"{API}/sign/session/challenges/{ch['challengeId']}/confirm", json={"code": sms.last_code()})
    assert r.status_code == 200, r.text
    assert set(r.json()["signed"]) == {contract["id"], order["id"]}

    r = await http.get(f"{API}/hr-edo/documents/{contract['id']}", headers=bearer(accountant))
    doc = r.json()
    assert doc["status"] == "signed"
    assert doc["hasStamped"]
    roles = {s["signerRole"]: s for s in doc["signatures"]}
    assert roles["employee"]["sigType"] == "unep_lg"
    assert roles["employee"]["fingerprint"] == key["fingerprint"]
    assert roles["employee"]["phoneMasked"] == "+7 ••• ••• 45-67"
    assert roles["employer"]["sigType"] == "ukep"

    # Лист подписания: исходник + 1 страница, исходный PDF не изменился.
    r = await http.get(f"{API}/hr-edo/documents/{contract['id']}/file?kind=stamped", headers=bearer(accountant))
    assert len(PdfReader(io.BytesIO(r.content)).pages) == 2
    r = await http.get(f"{API}/hr-edo/documents/{contract['id']}/file", headers=bearer(accountant))
    assert storage.sha256_hex(r.content) == doc["contentSha256"]

    # .sig проверяется независимо по открытому ключу.
    sig_id = roles["employee"]["id"]
    r = await http.get(
        f"{API}/hr-edo/documents/{contract['id']}/signatures/{sig_id}/file", headers=bearer(accountant)
    )
    assert r.status_code == 200
    res = await crypto_mod.crypto_service().verify(signature=r.content, digest=doc["contentStreebog256"])
    assert res.valid

    # Протокол целостный; кода нет ни в логах, ни в протоколе.
    r = await http.get(f"{API}/hr-edo/events/verify", headers=bearer(accountant))
    assert r.json()["ok"] is True and r.json()["checked"] > 10
    codes = {re.search(r"Код (\d{6})", t).group(1) for _, t in sms.sent}  # type: ignore[union-attr]
    logs = caplog.text
    events = (await db.execute(select(HrDocEvent.payload))).scalars().all()
    for code in codes:
        assert code not in logs
        assert all(code not in str(p) for p in events)
    challenges = (await db.execute(select(HrSignChallenge))).scalars().all()
    for ch_row in challenges:
        assert not any(code in ch_row.code_hmac for code in codes)


async def test_employee_from_candidate_only_when_hired(http, db, accountant) -> None:
    cand = Candidate(full_name="Сидорова Анна", role="QA", status=CandidateStatus.offer, phone="+7 916 000-11-22")
    db.add(cand)
    await db.commit()
    r = await http.post(f"{API}/hr-edo/employees/from-candidate/{cand.id}", headers=bearer(accountant))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "candidate_not_hired"
    cand.status = CandidateStatus.hired
    await db.commit()
    r = await http.post(f"{API}/hr-edo/employees/from-candidate/{cand.id}", headers=bearer(accountant))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["fullName"] == "Сидорова Анна" and body["phone"] == "+79160001122"
    assert body["candidateId"] == str(cand.id)
    r = await http.post(f"{API}/hr-edo/employees/from-candidate/{cand.id}", headers=bearer(accountant))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "employee_exists"


# ════════════════════════════════════════════════════════════════════════════
# Матрица при исполнении
# ════════════════════════════════════════════════════════════════════════════


async def test_consent_package_rejects_unep_lg(http, accountant, sms) -> None:
    emp = await create_employee(http, accountant)
    await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(accountant))
    r = await http.post(
        f"{API}/hr-edo/employees/{emp['id']}/consent",
        data={"sigType": "unep_lg"},
        files={"file": ("c.sig", b"sig", "application/octet-stream")},
        headers=bearer(accountant),
    )
    assert r.status_code == 422 and r.json()["detail"]["code"] == "sig_type_not_allowed"


async def test_paper_only_cannot_be_sent(http, accountant) -> None:
    emp = await create_employee(http, accountant)
    r = await http.post(
        f"{API}/hr-edo/documents/upload",
        data={"employeeId": emp["id"], "typeCode": "order_dismissal"},
        files={"file": ("scan.pdf", await fake_pdf("x"), "application/pdf")},
        headers=bearer(accountant),
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "archived_paper"
    r = await http.post(f"{API}/hr-edo/documents/send", json={"ids": [r.json()["id"]]}, headers=bearer(accountant))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "paper_only"


async def test_key_not_issued_without_consent(http, db, accountant, sms) -> None:
    emp = await create_employee(http, accountant)
    r = await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(accountant))
    token = r.json()["portalUrl"].rsplit("/", 1)[-1]
    await portal_login(http, token, sms)
    r = await http.post(f"{API}/sign/session/key/otp")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "consent_required"


async def test_freeze_requires_fields_and_send_requires_active_key(http, accountant) -> None:
    emp = await create_employee(http, accountant)
    r = await http.post(
        f"{API}/hr-edo/documents",
        json={"typeCode": "vacation_request", "employeeIds": [emp["id"]], "fields": {}, "freeze": True},
        headers=bearer(accountant),
    )
    assert r.status_code == 422 and r.json()["detail"]["code"] == "fields_required"
    r = await http.post(
        f"{API}/hr-edo/documents",
        json={
            "typeCode": "vacation_request",
            "employeeIds": [emp["id"]],
            "fields": {
                "vacation_type": "ежегодный оплачиваемый",
                "vacation_start": "2026-11-02",
                "vacation_end": "2026-11-15",
                "vacation_days": "14",
            },
            "freeze": True,
        },
        headers=bearer(accountant),
    )
    assert r.status_code == 201, r.text
    doc = r.json()[0]
    assert doc["status"] == "frozen" and re.fullmatch(r"ЗО-\d{4}-0001", doc["number"])
    r = await http.post(f"{API}/hr-edo/documents/send", json={"ids": [doc["id"]]}, headers=bearer(accountant))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "employee_not_ready"


async def test_preview_returns_html_with_draft_mark(http, accountant) -> None:
    r = await http.post(
        f"{API}/hr-edo/documents/preview",
        json={"typeCode": "employment_contract", "fields": {"salary": "100000"}},
        headers=bearer(accountant),
    )
    assert r.status_code == 200
    assert "ЧЕРНОВИК - ТЕКСТ НА СОГЛАСОВАНИИ У ЮРИСТА" in r.text
    assert "100 000" in r.text


# ════════════════════════════════════════════════════════════════════════════
# OTP
# ════════════════════════════════════════════════════════════════════════════


async def _logged_in_active(http, db, accountant, sms) -> dict:
    emp, _ = await onboard(http, accountant, sms)
    token = await fresh_token(db, emp["id"])
    await portal_login(http, token, sms)
    return emp


async def test_otp_wrong_code_attempts_then_locked(http, db, accountant, sms, fake_redis) -> None:
    emp = await create_employee(http, accountant)
    r = await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(accountant))
    token = r.json()["portalUrl"].rsplit("/", 1)[-1]
    ch = (await http.post(f"{API}/sign/{token}/login/otp")).json()
    good = sms.last_code()
    bad = "000000" if good != "000000" else "111111"
    for left in (4, 3, 2, 1):
        r = await http.post(f"{API}/sign/{token}/login/verify", json={"challengeId": ch["challengeId"], "code": bad})
        assert r.status_code == 422
        assert r.json()["detail"]["details"]["attemptsLeft"] == left
    r = await http.post(f"{API}/sign/{token}/login/verify", json={"challengeId": ch["challengeId"], "code": bad})
    assert r.status_code == 423
    # Даже верный код после блокировки не проходит.
    r = await http.post(f"{API}/sign/{token}/login/verify", json={"challengeId": ch["challengeId"], "code": good})
    assert r.status_code == 423


async def test_otp_resend_cooldown_and_hourly_limit(http, db, accountant, sms, fake_redis) -> None:
    emp = await create_employee(http, accountant)
    r = await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(accountant))
    token = r.json()["portalUrl"].rsplit("/", 1)[-1]
    assert (await http.post(f"{API}/sign/{token}/login/otp")).status_code == 200
    r = await http.post(f"{API}/sign/{token}/login/otp")
    assert r.status_code == 429 and r.json()["detail"]["code"] == "otp_cooldown"
    for i in range(2, 6):
        await fake_redis.delete(f"hr_edo:otp:cooldown:{emp['id']}:portal_login")
        assert (await http.post(f"{API}/sign/{token}/login/otp")).status_code == 200, i
    await fake_redis.delete(f"hr_edo:otp:cooldown:{emp['id']}:portal_login")
    r = await http.post(f"{API}/sign/{token}/login/otp")
    assert r.status_code == 429 and r.json()["detail"]["code"] == "otp_rate_limited"


async def test_otp_expired(http, db, accountant, sms) -> None:
    emp = await create_employee(http, accountant)
    r = await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(accountant))
    token = r.json()["portalUrl"].rsplit("/", 1)[-1]
    ch = (await http.post(f"{API}/sign/{token}/login/otp")).json()
    row = await db.get(HrSignChallenge, uuid.UUID(ch["challengeId"]))
    assert row is not None
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db.commit()
    r = await http.post(f"{API}/sign/{token}/login/verify", json={"challengeId": ch["challengeId"], "code": sms.last_code()})
    assert r.status_code == 410


async def test_otp_purpose_not_interchangeable_and_scope_bound(http, db, accountant, admin_user, sms, fake_redis) -> None:
    emp = await _logged_in_active(http, db, accountant, sms)
    # Код входа не подходит для выпуска ключа.
    login_ch = (await db.execute(
        select(HrSignChallenge).where(HrSignChallenge.purpose == "portal_login").order_by(HrSignChallenge.created_at.desc())
    )).scalars().first()
    assert login_ch is not None
    r = await http.post(f"{API}/sign/session/key/issue", json={"challengeId": str(login_ch.id), "code": "123456"})
    assert r.status_code == 409 and r.json()["detail"]["code"] in ("otp_purpose_mismatch", "otp_used")

    await issue_key_portal(http, sms)
    contract, order = await make_contract_and_order(http, accountant, emp["id"])
    for d in (contract, order):
        await employer_sign(http, admin_user, d["id"])
    await http.post(f"{API}/hr-edo/documents/send", json={"ids": [contract["id"], order["id"]]}, headers=bearer(accountant))

    await read_to_end(http, contract["id"], order["id"])
    # Код, выданный для пакета A (договор), не подписывает пакет B (приказ).
    ch_a = (await http.post(f"{API}/sign/session/challenges", json={"documentIds": [contract["id"]]})).json()
    code_a = sms.last_code()
    row = await db.get(HrSignChallenge, uuid.UUID(ch_a["challengeId"]))
    assert row is not None and row.document_ids == [uuid.UUID(contract["id"])]
    # Подменить набор документов у челленджа — хеш набора не совпадёт.
    await db.execute(
        text("UPDATE hr_sign_challenges SET document_ids = ARRAY[CAST(:d AS uuid)] WHERE id = :id"),
        {"d": order["id"], "id": ch_a["challengeId"]},
    )
    await db.commit()
    db.expire_all()
    r = await http.post(f"{API}/sign/session/challenges/{ch_a['challengeId']}/confirm", json={"code": code_a})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "otp_scope_mismatch"


# ════════════════════════════════════════════════════════════════════════════
# Ключи, activation_token, целостность
# ════════════════════════════════════════════════════════════════════════════


async def test_activation_token_one_time_and_bound() -> None:
    from app.modules.hr_edo.signing import issue_activation_token

    svc = crypto_mod.NoopCryptoService()
    key = await svc.create_key(owner_ref="x")
    digest = "a" * 64
    token = issue_activation_token(key_id=key.key_id, digest=digest, challenge_id=uuid.uuid4())
    # Чужой digest / key_id — отказ.
    with pytest.raises(crypto_mod.CryptoServiceError) as e1:
        await svc.sign(key_id=key.key_id, digest="b" * 64, activation_token=token)
    assert e1.value.code == "activation_mismatch"
    with pytest.raises(crypto_mod.CryptoServiceError):
        await svc.sign(key_id="other", digest=digest, activation_token=token)
    # Без токена (мусор) — отказ.
    with pytest.raises(crypto_mod.CryptoServiceError) as e2:
        await svc.sign(key_id=key.key_id, digest=digest, activation_token="not-a-jwt")
    assert e2.value.code == "activation_invalid"
    # Один раз — ок, второй — отказ.
    res = await svc.sign(key_id=key.key_id, digest=digest, activation_token=token)
    assert (await svc.verify(signature=res.signature, digest=digest, key_id=key.key_id)).valid
    with pytest.raises(crypto_mod.CryptoServiceError) as e3:
        await svc.sign(key_id=key.key_id, digest=digest, activation_token=token)
    assert e3.value.code == "activation_reused"


async def test_activation_token_expires() -> None:
    import jwt as pyjwt

    from app.core.config import get_settings

    svc = crypto_mod.NoopCryptoService()
    expired = pyjwt.encode(
        {"sub": "k", "dig": "d", "jti": "j", "aud": crypto_mod.ACTIVATION_AUDIENCE,
         "exp": int((datetime.now(timezone.utc) - timedelta(seconds=5)).timestamp())},
        get_settings().hr_edo_activation_secret,
        algorithm="HS256",
    )
    with pytest.raises(crypto_mod.CryptoServiceError):
        await svc.sign(key_id="k", digest="d", activation_token=expired)


async def test_revoked_key_blocks_signing_but_old_signature_stays_valid(
    http, db, accountant, admin_user, sms, fake_redis
) -> None:
    emp = await _logged_in_active(http, db, accountant, sms)
    await issue_key_portal(http, sms)
    contract, order = await make_contract_and_order(http, accountant, emp["id"])
    for d in (contract, order):
        await employer_sign(http, admin_user, d["id"])
    await http.post(f"{API}/hr-edo/documents/send", json={"ids": [contract["id"], order["id"]]}, headers=bearer(accountant))
    await read_to_end(http, contract["id"], order["id"])
    ch = (await http.post(f"{API}/sign/session/challenges", json={"documentIds": [contract["id"]]})).json()
    r = await http.post(f"{API}/sign/session/challenges/{ch['challengeId']}/confirm", json={"code": sms.last_code()})
    assert r.status_code == 200

    r = await http.post(
        f"{API}/hr-edo/employees/{emp['id']}/keys/revoke", json={"reason": "утеря SIM"}, headers=bearer(accountant)
    )
    assert r.status_code == 200 and r.json()["edoStatus"] == "key_revoked"
    await fake_redis.delete(f"hr_edo:otp:cooldown:{emp['id']}:sign")
    r = await http.post(f"{API}/sign/session/challenges", json={"documentIds": [order["id"]]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "key_required"

    doc = (await http.get(f"{API}/hr-edo/documents/{contract['id']}", headers=bearer(accountant))).json()
    emp_sig = next(s for s in doc["signatures"] if s["signerRole"] == "employee")
    data = (await http.get(
        f"{API}/hr-edo/documents/{contract['id']}/signatures/{emp_sig['id']}/file", headers=bearer(accountant)
    )).content
    assert (await crypto_mod.crypto_service().verify(signature=data, digest=doc["contentStreebog256"])).valid


async def test_tampered_s3_file_blocks_signing(http, db, accountant, admin_user, sms) -> None:
    emp = await _logged_in_active(http, db, accountant, sms)
    await issue_key_portal(http, sms)
    contract, _ = await make_contract_and_order(http, accountant, emp["id"])
    await employer_sign(http, admin_user, contract["id"])
    await http.post(f"{API}/hr-edo/documents/send", json={"ids": [contract["id"]]}, headers=bearer(accountant))
    await read_to_end(http, contract["id"])
    ch = (await http.post(f"{API}/sign/session/challenges", json={"documentIds": [contract["id"]]})).json()

    doc_row = await db.get(HrDocument, uuid.UUID(contract["id"]))
    from app.modules.files.models import File

    f = await db.get(File, doc_row.source_file_id)  # type: ignore[union-attr]
    storage.s3().upload_bytes(file_key=f.file_key, data=b"%PDF-1.4 tampered", mime="application/pdf")  # type: ignore[union-attr]
    r = await http.post(f"{API}/sign/session/challenges/{ch['challengeId']}/confirm", json={"code": sms.last_code()})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "integrity_error"
    # Попытка зафиксирована в протоколе, несмотря на откат основной транзакции.
    kinds = (
        await db.execute(select(HrDocEvent.kind).where(HrDocEvent.document_id == uuid.UUID(contract["id"])))
    ).scalars().all()
    assert "integrity_failed" in {k.value for k in kinds}


# ════════════════════════════════════════════════════════════════════════════
# Протокол
# ════════════════════════════════════════════════════════════════════════════


async def test_event_trigger_forbids_update_and_delete(db, accountant) -> None:
    ev = await evidence.record_event(db, kind="employee_created", actor=evidence.Actor.system())  # type: ignore[arg-type]
    await db.commit()
    for stmt in ("UPDATE hr_doc_events SET actor_name = 'x' WHERE id = :id", "DELETE FROM hr_doc_events WHERE id = :id"):
        with pytest.raises(DBAPIError):
            async with db.begin_nested():
                await db.execute(text(stmt), {"id": ev.id})


async def test_chain_detects_edit_insert_delete(db) -> None:
    actor = evidence.Actor.system()
    for i in range(4):
        await evidence.record_event(db, kind="employee_created", actor=actor, payload={"i": i})  # type: ignore[arg-type]
    await db.commit()
    rows = list((await db.execute(select(HrDocEvent).order_by(HrDocEvent.id))).scalars())
    assert evidence.verify_rows(rows).ok

    def clone(ev: HrDocEvent, **patch: object) -> HrDocEvent:
        c = HrDocEvent(**{col.key: getattr(ev, col.key) for col in HrDocEvent.__table__.columns})
        for k, v in patch.items():
            setattr(c, k, v)
        return c

    edited = [clone(r) for r in rows]
    edited[1].payload = {"i": 999}
    assert evidence.verify_rows(edited).broken_at_id == rows[1].id

    deleted = [clone(r) for r in rows if r.id != rows[2].id]
    assert not evidence.verify_rows(deleted).ok

    inserted = [clone(r) for r in rows]
    fake = clone(rows[1], id=10**9, payload={"forged": True})
    inserted.insert(2, fake)
    assert not evidence.verify_rows(inserted).ok


# ════════════════════════════════════════════════════════════════════════════
# Портал и «Мои документы»
# ════════════════════════════════════════════════════════════════════════════


async def test_portal_links_expired_revoked_and_foreign_document(http, db, accountant, sms) -> None:
    emp = await create_employee(http, accountant)
    r = await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(accountant))
    old = r.json()["portalUrl"].rsplit("/", 1)[-1]
    new = await fresh_token(db, emp["id"])  # новая ссылка отзывает старую
    assert (await http.get(f"{API}/sign/{old}")).status_code == 404
    info = await http.get(f"{API}/sign/{new}")
    assert info.status_code == 200 and info.json()["employeeName"] == "Пётр П."

    from app.modules.hr_edo.models import HrAccessToken

    tok = (await db.execute(select(HrAccessToken).where(HrAccessToken.revoked_at.is_(None)))).scalars().first()
    assert tok is not None
    tok.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db.commit()
    assert (await http.get(f"{API}/sign/{new}")).status_code == 410

    # Чужой документ через сессию — 404.
    other = await _logged_in_active(http, db, accountant, sms)
    stranger = await create_employee(http, accountant, fullName="Чужой Сотрудник", phone="+79990000000", email=None)
    r = await http.post(
        f"{API}/hr-edo/documents",
        json={"typeCode": "lna_acknowledgment", "employeeIds": [stranger["id"]],
              "fields": {"lna_title": "ПВТР", "lna_date": "2026-01-01"}, "freeze": True},
        headers=bearer(accountant),
    )
    foreign = r.json()[0]
    assert other["id"] != stranger["id"]
    assert (await http.get(f"{API}/sign/session/documents/{foreign['id']}/file")).status_code == 404
    assert (await http.get(f"{API}/sign/session/documents")).status_code == 200


async def test_portal_requires_session(http) -> None:
    r = await http.get(f"{API}/sign/session/documents")
    assert r.status_code == 401


async def test_my_documents_for_crm_user_without_sms_login(
    http, db, accountant, admin_user, employee_user, sms
) -> None:
    r = await http.get(f"{API}/hr-edo/my", headers=bearer(employee_user))
    assert r.status_code == 200 and r.json()["employee"] is None

    emp = await create_employee(http, accountant, userId=str(employee_user.id), email=None)
    await http.post(f"{API}/hr-edo/employees/{emp['id']}/invite", headers=bearer(accountant))
    await http.post(
        f"{API}/hr-edo/employees/{emp['id']}/consent",
        data={"sigType": "paper"},
        files={"file": ("c.pdf", await fake_pdf("s"), "application/pdf")},
        headers=bearer(accountant),
    )
    ch = (await http.post(f"{API}/hr-edo/my/key/otp", headers=bearer(employee_user))).json()
    r = await http.post(
        f"{API}/hr-edo/my/key/issue", json={"challengeId": ch["challengeId"], "code": sms.last_code()},
        headers=bearer(employee_user),
    )
    assert r.status_code == 200, r.text

    r = await http.post(
        f"{API}/hr-edo/documents",
        json={"typeCode": "lna_acknowledgment", "employeeIds": [emp["id"]],
              "fields": {"lna_title": "Положение о КЭДО", "lna_date": "2026-09-01"}, "freeze": True},
        headers=bearer(accountant),
    )
    doc = r.json()[0]
    assert doc["status"] == "frozen"
    r = await http.post(f"{API}/hr-edo/documents/send", json={"ids": [doc["id"]]}, headers=bearer(accountant))
    assert r.status_code == 200 and r.json()["portalLinks"] == {}

    overview = (await http.get(f"{API}/hr-edo/my", headers=bearer(employee_user))).json()
    assert overview["employee"]["pendingCount"] == 1
    # Уведомление в CRM пришло.
    notes = (await http.get(f"{API}/notifications", headers=bearer(employee_user))).json()
    assert any("Документ на подпись" in n["text"] for n in notes)

    await read_to_end(http, doc["id"], prefix="/hr-edo/my", headers=bearer(employee_user))
    ch = (await http.post(f"{API}/hr-edo/my/challenges", json={"documentIds": [doc["id"]]}, headers=bearer(employee_user))).json()
    r = await http.post(
        f"{API}/hr-edo/my/challenges/{ch['challengeId']}/confirm", json={"code": sms.last_code()},
        headers=bearer(employee_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["documents"][0]["status"] == "signed"

    # Рекрутер не видит чужие документы через /hr-edo/documents.
    assert (await http.get(f"{API}/hr-edo/documents/{doc['id']}", headers=bearer(employee_user))).status_code == 403


async def test_reject_with_reason_notifies_author(http, db, accountant, admin_user, sms) -> None:
    emp = await _logged_in_active(http, db, accountant, sms)
    await issue_key_portal(http, sms)
    contract, _ = await make_contract_and_order(http, accountant, emp["id"])
    await employer_sign(http, admin_user, contract["id"])
    await http.post(f"{API}/hr-edo/documents/send", json={"ids": [contract["id"]]}, headers=bearer(accountant))
    r = await http.post(f"{API}/sign/session/documents/{contract['id']}/reject", json={"reason": "не тот оклад"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    notes = (await http.get(f"{API}/notifications", headers=bearer(accountant))).json()
    assert any("не тот оклад" in n["text"] for n in notes)


# ════════════════════════════════════════════════════════════════════════════
# Конфигурация
# ════════════════════════════════════════════════════════════════════════════


def test_prod_refuses_log_sms_and_noop_crypto() -> None:
    from app.core.config import Settings, validate_hr_edo_settings

    s = Settings(env="prod", hr_edo_enabled=True, sms_provider="log", crypto_service_url="")
    with pytest.raises(RuntimeError) as e:
        validate_hr_edo_settings(s)
    assert "SMS_PROVIDER=log" in str(e.value) and "CRYPTO_SERVICE_URL" in str(e.value)
    # Не включённый на контуре модуль не мешает старту.
    validate_hr_edo_settings(Settings(env="prod", sms_provider="log"))
    ok = Settings(
        env="prod", hr_edo_enabled=True, sms_provider="smsc", crypto_service_url="http://crypto:8090",
        hr_edo_otp_secret="s1", hr_edo_activation_secret="s2",
    )
    validate_hr_edo_settings(ok)


def test_sms_text_and_scrubber() -> None:
    from app.integrations.sms import scrub_sensitive
    from app.modules.hr_edo.models import ChallengePurpose
    from app.modules.hr_edo.otp import build_sms_text

    t = build_sms_text(ChallengePurpose.sign, "482913", "«Трудовой договор № ТД-2026-0007»")
    assert t.startswith("Код 482913 — подписание «Трудовой договор № ТД-2026-0007»")
    assert t.endswith("#482913")
    scrubbed = scrub_sensitive(t + " +79991234567")
    assert "482913" not in scrubbed and "9991234567" not in scrubbed


async def test_unread_document_cannot_be_signed(http, db, accountant, admin_user, sms) -> None:
    emp = await _logged_in_active(http, db, accountant, sms)
    await issue_key_portal(http, sms)
    contract, _ = await make_contract_and_order(http, accountant, emp["id"])
    await employer_sign(http, admin_user, contract["id"])
    await http.post(f"{API}/hr-edo/documents/send", json={"ids": [contract["id"]]}, headers=bearer(accountant))
    r = await http.post(f"{API}/sign/session/challenges", json={"documentIds": [contract["id"]]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_read"


async def test_phone_change_closes_portal_session(http, db, accountant, sms) -> None:
    emp = await _logged_in_active(http, db, accountant, sms)
    assert (await http.get(f"{API}/sign/session")).status_code == 200
    r = await http.post(
        f"{API}/hr-edo/employees/{emp['id']}/phone",
        json={"phone": "+79995550000", "reason": "утеря SIM-карты"},
        headers=bearer(accountant),
    )
    assert r.status_code == 200, r.text
    assert (await http.get(f"{API}/sign/session")).status_code == 401


async def test_linking_crm_user_is_logged(http, db, accountant, employee_user) -> None:
    emp = await create_employee(http, accountant)
    r = await http.patch(
        f"{API}/hr-edo/employees/{emp['id']}", json={"userId": str(employee_user.id)}, headers=bearer(accountant)
    )
    assert r.status_code == 200 and r.json()["userName"] == employee_user.full_name
    ev = (await http.get(f"{API}/hr-edo/events?employeeId={emp['id']}", headers=bearer(accountant))).json()["items"]
    upd = next(e for e in ev if e["kind"] == "employee_updated")
    assert upd["payload"]["fields"] == ["userId"]
    assert upd["payload"]["after"]["userId"] == str(employee_user.id)


async def test_generic_files_presign_rejects_hr_documents(http, accountant) -> None:
    r = await http.post(
        f"{API}/files/presign",
        json={"entityType": "hr_document", "entityId": str(uuid.uuid4()), "originalName": "x.pdf", "mime": "application/pdf", "size": 10},
        headers=bearer(accountant),
    )
    assert r.status_code == 422 and r.json()["detail"]["code"] == "entity_type_forbidden"


def test_client_ip_ignores_spoofed_forwarded_for() -> None:
    from starlette.requests import Request

    def req(headers: dict[str, str]) -> Request:
        return Request({
            "type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": ("10.0.0.1", 1),
        })

    assert hr_ep.client_ip(req({"X-Forwarded-For": "1.2.3.4, 203.0.113.9"})) == "203.0.113.9"
    assert hr_ep.client_ip(req({"X-Real-IP": "198.51.100.7", "X-Forwarded-For": "1.2.3.4"})) == "198.51.100.7"
    assert hr_ep.client_ip(req({})) == "10.0.0.1"
