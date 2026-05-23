"""Импорт seed-данных из frontend/seed_data.json в staging-БД.

Контекст: данные генерируются через `pnpm export-seed` на фронте — это JSON-дамп
`src/mocks/db/*.ts`. Скрипт **одноразовый** и предназначен исключительно для
демо/staging (см. План_перехода_на_API.docx §7). В production его запускать
не нужно: реальная история начинается с нуля.

Идемпотентно: если в БД уже есть users — ничего не делает (выход без ошибки).

Маппинг id: фронтовые строки 'u1', 'c1', 'v1', ... превращаются в стабильные
UUID5 от фиксированного namespace, чтобы повторный запуск не плодил дубли.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.modules.candidates.models import Candidate, CandidateStatus, EmploymentType
from app.modules.clients.models import (
    Client,
    ClientKind,
    ClientStatus,
    Contact,
    LegalEntity,
)
from app.modules.comments.models import Comment, CommentEntityType
from app.modules.matching.models import VacancyCandidate
from app.modules.notifications.models import (
    Notification,
    NotificationEntityType,
    NotificationKind,
)
from app.modules.users.models import Role, User, compute_initials
from app.modules.vacancies.models import (
    EngagementType,
    Grade,
    Priority,
    Vacancy,
    VacancyRecruiter,
    VacancyStatus,
    WorkFormat,
)

NAMESPACE = uuid.UUID("a55fd2cb-3aa6-4f3a-a83c-1bcc0b1adcaa")

DEFAULT_SEED_PASSWORD = os.environ.get("SEED_DEFAULT_PASSWORD", "staging-password-123!")


def to_uuid(prefix: str, raw_id: str) -> uuid.UUID:
    """Стабильный UUID5 для фронтовых string-id (u1, c1, ...)."""
    return uuid.uuid5(NAMESPACE, f"{prefix}:{raw_id}")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


async def _seed_users(db, users: list[dict[str, Any]]) -> dict[str, uuid.UUID]:
    pwd = hash_password(DEFAULT_SEED_PASSWORD)
    mapping: dict[str, uuid.UUID] = {}
    for u in users:
        new_id = to_uuid("user", u["id"])
        mapping[u["id"]] = new_id
        db.add(
            User(
                id=new_id,
                email=u["email"],
                password_hash=pwd,
                full_name=u["fullName"],
                role=Role(u["role"]),
                is_active=u.get("isActive", True),
                telegram=u.get("telegram"),
                initials=u.get("initials") or compute_initials(u["fullName"]),
                color=u.get("color") or "#94a3b8",
            )
        )
    return mapping


async def _seed_clients(
    db, clients: list[dict[str, Any]], contacts: list[dict[str, Any]], users: dict[str, uuid.UUID]
) -> dict[str, uuid.UUID]:
    mapping: dict[str, uuid.UUID] = {}
    by_client_contacts: dict[str, list[dict[str, Any]]] = {}
    for ct in contacts:
        by_client_contacts.setdefault(ct["clientId"], []).append(ct)

    for c in clients:
        new_id = to_uuid("client", c["id"])
        mapping[c["id"]] = new_id
        legal = [
            LegalEntity(id=to_uuid("legal", le["id"]), name=le["name"], inn=le["inn"])
            for le in c.get("legalEntities") or []
        ]
        client_contacts = [
            Contact(
                id=to_uuid("contact", ct["id"]),
                name=ct["name"],
                role=ct.get("role", ""),
                email=ct.get("email"),
                phone=ct.get("phone"),
                telegram=ct.get("telegram"),
                birthday=parse_date(ct.get("birthday")),
            )
            for ct in by_client_contacts.get(c["id"], [])
        ]
        db.add(
            Client(
                id=new_id,
                name=c["name"],
                industry=c.get("industry", ""),
                account_manager_id=users[c["accountManagerId"]],
                status=ClientStatus(c.get("status", "lead")),
                client_kind=ClientKind(c.get("clientKind", "direct")),
                telegram_chat=c.get("telegramChat"),
                legal_entities=legal,
                contacts=client_contacts,
            )
        )
    return mapping


async def _seed_vacancies(
    db, vacancies: list[dict[str, Any]], users: dict[str, uuid.UUID], clients: dict[str, uuid.UUID]
) -> dict[str, uuid.UUID]:
    mapping: dict[str, uuid.UUID] = {}
    for v in vacancies:
        new_id = to_uuid("vacancy", v["id"])
        mapping[v["id"]] = new_id
        recruiters = [
            VacancyRecruiter(user_id=users[rid]) for rid in v.get("recruiterIds") or []
        ]
        db.add(
            Vacancy(
                id=new_id,
                title=v.get("title", "Без названия"),
                client_id=clients[v["clientId"]],
                engagement_type=EngagementType(v.get("engagementType", "outstaff")),
                project=v.get("project"),
                grade=Grade(v.get("grade", "Middle")),
                stack=list(v.get("stack") or []),
                format_=WorkFormat(v.get("format", "Гибрид")),
                rate_client=float(v.get("rateClient") or 0),
                salary_max=(float(v["salaryMax"]) if v.get("salaryMax") else None),
                positions=int(v.get("positions") or 1),
                status=VacancyStatus(v.get("status", "new")),
                priority=Priority(v.get("priority", "medium")),
                account_manager_id=users[v["accountManagerId"]],
                deadline=parse_date(v.get("deadline")),
                kanban_order=int(v.get("kanbanOrder") or 0),
                description=v.get("description"),
                requirements=v.get("requirements"),
                recruiters=recruiters,
            )
        )
    return mapping


async def _seed_candidates(
    db,
    candidates: list[dict[str, Any]],
    users: dict[str, uuid.UUID],
    vacancies: dict[str, uuid.UUID],
) -> dict[str, uuid.UUID]:
    mapping: dict[str, uuid.UUID] = {}
    for c in candidates:
        new_id = to_uuid("candidate", c["id"])
        mapping[c["id"]] = new_id
        resume = {
            key: c[key]
            for key in (
                "skillCategories",
                "experience",
                "education",
                "certifications",
                "languages",
            )
            if c.get(key)
        }
        db.add(
            Candidate(
                id=new_id,
                full_name=c["fullName"],
                role=c.get("role", ""),
                engagement_type=EngagementType(c.get("engagementType", "outstaff")),
                grade=Grade(c.get("grade", "Middle")),
                experience_years=float(c.get("experienceYears") or 0),
                stack=list(c.get("stack") or []),
                rate_month=(float(c["rateMonth"]) if c.get("rateMonth") is not None else None),
                employment_type=EmploymentType(c.get("employmentType", "СМЗ")),
                format_=WorkFormat(c.get("format", "Гибрид")),
                location=c.get("location", ""),
                recruiter_id=users[c["recruiterId"]],
                status=CandidateStatus(c.get("status", "new")),
                telegram=c.get("telegram"),
                phone=c.get("phone"),
                email=c.get("email"),
                birthday=parse_date(c.get("birthday")),
                kanban_order=int(c.get("kanbanOrder") or 0),
                summary=c.get("summary"),
                archived=bool(c.get("archived") or False),
                archived_at=parse_iso(c.get("archivedAt")),
                archived_by_id=(
                    users[c["archivedById"]] if c.get("archivedById") in users else None
                ),
                archive_reason=c.get("archiveReason"),
                resume=resume,
            )
        )
    # связки vacancyIds → vacancy_candidates
    await db.flush()
    for c in candidates:
        for vid in c.get("vacancyIds") or []:
            if vid not in vacancies:
                continue
            db.add(
                VacancyCandidate(
                    vacancy_id=vacancies[vid],
                    candidate_id=mapping[c["id"]],
                    added_by_id=users[c["recruiterId"]],
                )
            )
    return mapping


async def _seed_comments(
    db,
    comments: list[dict[str, Any]],
    users: dict[str, uuid.UUID],
    clients: dict[str, uuid.UUID],
    vacancies: dict[str, uuid.UUID],
    candidates: dict[str, uuid.UUID],
) -> None:
    # Маппинг entityId по типу
    entity_maps: dict[str, dict[str, uuid.UUID]] = {
        "client": clients,
        "vacancy": vacancies,
        "candidate": candidates,
        "contact": {},  # contacts уже в БД, но фронт-моки на контактах комментариев не строят
    }
    for cm in comments:
        et = cm["entityType"]
        eid_raw = cm["entityId"]
        eid = entity_maps.get(et, {}).get(eid_raw)
        if eid is None:
            continue
        author = users.get(cm["authorId"])
        if author is None:
            continue
        db.add(
            Comment(
                id=to_uuid("comment", cm["id"]),
                entity_type=CommentEntityType(et),
                entity_id=eid,
                author_id=author,
                parent_id=(
                    to_uuid("comment", cm["parentId"]) if cm.get("parentId") else None
                ),
                text_=cm["text"],
                mentions=[
                    users[m] for m in cm.get("mentions") or [] if m in users
                ],
            )
        )


async def _seed_notifications(
    db, notifications: list[dict[str, Any]], users: dict[str, uuid.UUID]
) -> None:
    for n in notifications:
        recipient = users.get(n["userId"])
        if recipient is None:
            continue
        db.add(
            Notification(
                user_id=recipient,
                kind=NotificationKind(n.get("kind", "system")),
                text_=n["text"],
                entity_type=(
                    NotificationEntityType(n["entityType"]) if n.get("entityType") else None
                ),
                entity_id=(
                    to_uuid(n["entityType"], n["entityId"])
                    if n.get("entityType") and n.get("entityId")
                    else None
                ),
                read_at=(parse_iso(n.get("createdAt")) if n.get("read") else None),
            )
        )


async def seed_from_mocks(json_path: Path) -> None:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    async with SessionLocal() as db:
        existing = (await db.execute(select(User.id).limit(1))).scalar_one_or_none()
        if existing is not None:
            print("[seed_from_mocks] users-таблица не пуста — пропускаю.")
            return

        users = await _seed_users(db, data["users"])
        clients = await _seed_clients(db, data["clients"], data["contacts"], users)
        vacancies = await _seed_vacancies(db, data["vacancies"], users, clients)
        candidates = await _seed_candidates(db, data["candidates"], users, vacancies)
        await _seed_comments(db, data["comments"], users, clients, vacancies, candidates)
        await _seed_notifications(db, data["notifications"], users)
        await db.commit()

    print(
        "[seed_from_mocks] импорт завершён:",
        {k: len(v) for k, v in data.items()},
    )
    print(f"[seed_from_mocks] всем пользователям выдан пароль: {DEFAULT_SEED_PASSWORD!r}")
    print("[seed_from_mocks] СМЕНИТЕ ИХ ПЕРЕД ДЕМО.")


def main() -> None:
    default_path = (
        Path(__file__).resolve().parents[2] / "frontend" / "seed_data.json"
    )
    json_path = Path(sys.argv[1]) if len(sys.argv) > 1 else default_path
    if not json_path.exists():
        raise SystemExit(
            f"[seed_from_mocks] JSON не найден: {json_path}.\n"
            f"Сгенерируйте его: cd frontend && pnpm export-seed"
        )
    asyncio.run(seed_from_mocks(json_path))


if __name__ == "__main__":
    main()
