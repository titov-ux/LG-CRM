"""Сервис кандидатов: CRUD, фильтры, archive/restore, kanban, статус.

Резюме-поля (`skill_categories`, `experience`, ...) храним одной jsonb-колонкой
`resume`. Сборка из JSONB → DTO и обратно — в `_to_dto` / `_apply_resume_patch`.

Видимость на этапе 5 либеральная — все авторизованные видят базу кандидатов
(право `candidates.view` в матрице — все 4 роли). Чувствительные поля
(`email`, `phone`, `rate_month`) маскируются для роли `viewer` (см. ТЗ §6.3).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.audit import service as audit_service
from app.modules.audit.models import ActivityEntityType, ActivityKind
from app.modules.candidates.models import Candidate, CandidateStatus
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind
from app.modules.candidates.schemas import (
    CandidateKanbanUpdate,
    ChangeCandidateStatusRequest,
    CreateCandidateRequest,
    UpdateCandidateRequest,
)
from app.modules.matching.models import VacancyCandidate
from app.modules.users.models import Role, User
from app.modules.vacancies.models import EngagementType

logger = logging.getLogger(__name__)


# Поля, что хранятся в resume jsonb (camelCase ключи — как на фронте).
RESUME_FIELDS = ("skill_categories", "experience", "education", "certifications", "languages")
_RESUME_CAMEL = {
    "skill_categories": "skillCategories",
    "experience": "experience",
    "education": "education",
    "certifications": "certifications",
    "languages": "languages",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _base_query() -> Select:
    return select(Candidate).where(Candidate.deleted_at.is_(None))


def _days_in_status(cand: Candidate) -> int:
    if not cand.status_changed_at:
        return 0
    status_changed_at = cand.status_changed_at
    # Защита от старых/грязных записей с naive-datetime.
    if status_changed_at.tzinfo is None:
        status_changed_at = status_changed_at.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - status_changed_at
    return max(int(delta.total_seconds() // 86400), 0)


def _ensure_can_mutate(user: User) -> None:
    if user.role not in (Role.admin, Role.recruiter):
        # account_manager по дефолту не редактирует кандидатов (см. permissions matrix)
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет прав на редактирование кандидата")


def _ensure_can_permanent_delete(user: User) -> None:
    if user.role != Role.admin:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Полное удаление кандидата — только админ",
        )


async def _ensure_valid_recruiter_id(db: AsyncSession, recruiter_id: uuid.UUID) -> None:
    recruiter = (
        await db.execute(select(User).where(User.id == recruiter_id, User.is_active.is_(True)))
    ).scalar_one_or_none()
    if recruiter is None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_recruiter",
            "Указанный рекрутер не найден или неактивен",
        )
    if recruiter.role not in (Role.recruiter, Role.admin):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_recruiter",
            "Ответственным может быть только recruiter или admin",
        )


def _raise_candidate_write_error(exc: Exception) -> None:
    text = str(exc).lower()
    if "email" in text and ("unique" in text or "duplicate" in text):
        raise ApiError(status.HTTP_409_CONFLICT, "duplicate_candidate", "Email уже занят") from exc
    if "recruiter_id" in text and ("foreign key" in text or "violates" in text):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_recruiter",
            "Указанный рекрутер не найден",
        ) from exc
    raise ApiError(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "invalid_candidate_payload",
        "Некорректные данные кандидата: проверьте формат и длину полей",
    ) from exc


async def _vacancy_ids_map(
    db: AsyncSession, candidate_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    ids = list(candidate_ids)
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(VacancyCandidate.candidate_id, VacancyCandidate.vacancy_id).where(
                VacancyCandidate.candidate_id.in_(ids)
            )
        )
    ).all()
    out: dict[uuid.UUID, list[uuid.UUID]] = {cid: [] for cid in ids}
    for cid, vid in rows:
        out[cid].append(vid)
    return out


# ---------------------------------------------------------------------------
# Resume jsonb helpers
# ---------------------------------------------------------------------------


def _apply_resume_patch(cand: Candidate, payload: dict[str, Any]) -> None:
    """Сливает резюме-поля payload в jsonb-колонку, оставляя нетронутыми остальные."""
    current: dict[str, Any] = dict(cand.resume or {})
    touched = False
    for snake in RESUME_FIELDS:
        if snake not in payload:
            continue
        camel = _RESUME_CAMEL[snake]
        value = payload[snake]
        if value is None:
            current.pop(camel, None)
        else:
            # Pydantic-модели → dict с alias=camelCase
            current[camel] = [item.model_dump(by_alias=True) if hasattr(item, "model_dump") else item for item in value]
        touched = True
    if touched:
        cand.resume = current


def _resume_get(cand: Candidate, snake: str) -> list[dict[str, Any]] | None:
    return (cand.resume or {}).get(_RESUME_CAMEL[snake])


def _next_kanban_order(peers: Iterable[Candidate]) -> int:
    """Безопасно считает следующий порядок даже при грязных данных в БД."""
    max_order = -1
    for peer in peers:
        value = getattr(peer, "kanban_order", None)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            max_order = max(max_order, value)
            continue
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        max_order = max(max_order, parsed)
    return max_order + 1


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def list_candidates(
    db: AsyncSession,
    user: User,
    *,
    search: str | None = None,
    status_: CandidateStatus | None = None,
    grade: str | None = None,
    recruiter_id: uuid.UUID | None = None,
    stack: str | None = None,
    engagement_type: EngagementType | None = None,
    employment_type: str | None = None,
    archived: bool | str | None = False,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Candidate], int, dict[uuid.UUID, list[uuid.UUID]]]:
    q = _base_query()
    # archived фильтр: 'all' / true / false. False (по умолчанию) = только активные.
    if archived == "all":
        pass
    elif archived is True:
        q = q.where(Candidate.archived.is_(True))
    else:
        q = q.where(Candidate.archived.is_(False))

    if status_ is not None:
        q = q.where(Candidate.status == status_)
    if grade is not None:
        q = q.where(Candidate.grade == grade)
    if recruiter_id is not None:
        q = q.where(Candidate.recruiter_id == recruiter_id)
    if engagement_type is not None:
        q = q.where(Candidate.engagement_type == engagement_type)
    if employment_type is not None:
        q = q.where(Candidate.employment_type == employment_type)
    if stack:
        # ?stack=Python,FastAPI — кандидат должен иметь все указанные технологии
        wanted = [s.strip() for s in stack.split(",") if s.strip()]
        if wanted:
            q = q.where(Candidate.stack.contains(wanted))
    if search:
        like = f"%{search.lower()}%"
        q = q.where(
            or_(
                func.lower(Candidate.full_name).like(like),
                func.lower(func.coalesce(Candidate.email, "")).like(like),
                func.lower(func.coalesce(Candidate.role, "")).like(like),
                func.lower(func.coalesce(Candidate.location, "")).like(like),
            )
        )

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    q = (
        q.order_by(Candidate.status, Candidate.kanban_order, Candidate.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = list((await db.execute(q)).scalars().all())
    vmap = await _vacancy_ids_map(db, [c.id for c in rows])
    return rows, int(total), vmap


async def get_candidate(
    db: AsyncSession, cand_id: uuid.UUID
) -> tuple[Candidate, list[uuid.UUID]]:
    cand = (await db.execute(_base_query().where(Candidate.id == cand_id))).scalar_one_or_none()
    if cand is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Кандидат не найден")
    vmap = await _vacancy_ids_map(db, [cand.id])
    return cand, vmap[cand.id]


async def create_candidate(
    db: AsyncSession, user: User, payload: CreateCandidateRequest
) -> tuple[Candidate, list[uuid.UUID]]:
    _ensure_can_mutate(user)
    await _ensure_valid_recruiter_id(db, payload.recruiter_id)

    # Дубль-чек по email/phone.
    duplicate: Candidate | None = None
    if payload.email:
        duplicate = (
            await db.execute(
                _base_query().where(Candidate.email == str(payload.email))
            )
        ).scalar_one_or_none()
    if duplicate is None and payload.phone:
        duplicate = (
            await db.execute(_base_query().where(Candidate.phone == payload.phone))
        ).scalar_one_or_none()
    if duplicate is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "duplicate_candidate",
            "Кандидат с таким email или телефоном уже есть в базе",
            details={"existingCandidateId": str(duplicate.id)},
        )

    # kanban_order — в конец колонки.
    in_col = (
        await db.execute(_base_query().where(Candidate.status == payload.status))
    ).scalars().all()
    order = _next_kanban_order(in_col)

    cand = Candidate(
        full_name=payload.full_name,
        role=payload.role,
        engagement_type=payload.engagement_type,
        grade=payload.grade,
        experience_years=float(payload.experience_years),
        stack=list(payload.stack),
        rate_month=float(payload.rate_month) if payload.rate_month is not None else None,
        employment_type=payload.employment_type,
        format_=payload.format,
        location=payload.location,
        recruiter_id=payload.recruiter_id,
        status=payload.status,
        status_changed_at=datetime.now(timezone.utc),
        telegram=payload.telegram,
        phone=payload.phone,
        email=str(payload.email) if payload.email else None,
        birthday=payload.birthday,
        kanban_order=order,
        summary=payload.summary,
        resume={},
    )
    _apply_resume_patch(cand, payload.model_dump(exclude_unset=True))
    db.add(cand)
    try:
        await db.flush()
        await db.commit()
    except (IntegrityError, DataError) as e:
        await db.rollback()
        _raise_candidate_write_error(e)
    await db.refresh(cand)
    created_candidate_id = cand.id
    try:
        # История активности не должна ронять создание кандидата:
        # если activity-подсистема временно недоступна, карточка всё равно сохраняется.
        await audit_service.record_activity(
            db,
            entity_type=ActivityEntityType.candidate,
            entity_id=cand.id,
            actor_id=user.id,
            kind=ActivityKind.create,
            text="Кандидат добавлен в базу",
        )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to write candidate create activity", extra={"candidate_id": str(cand.id)})
        # После rollback SQLAlchemy может инвалидировать состояние объекта cand.
        # Перечитываем карточку из БД, чтобы не допустить 500 на сериализации ответа.
        reloaded = (
            await db.execute(_base_query().where(Candidate.id == created_candidate_id))
        ).scalar_one_or_none()
        if reloaded is not None:
            cand = reloaded
    return cand, []


async def update_candidate(
    db: AsyncSession, user: User, cand_id: uuid.UUID, payload: UpdateCandidateRequest
) -> tuple[Candidate, list[uuid.UUID]]:
    _ensure_can_mutate(user)
    cand, _ = await get_candidate(db, cand_id)
    data = payload.model_dump(exclude_unset=True)

    for field in (
        "full_name",
        "role",
        "engagement_type",
        "grade",
        "employment_type",
        "location",
        "recruiter_id",
        "telegram",
        "phone",
        "birthday",
        "summary",
    ):
        if field in data:
            setattr(cand, field, data[field])
    if "format" in data and data["format"] is not None:
        cand.format_ = data["format"]
    if "experience_years" in data and data["experience_years"] is not None:
        cand.experience_years = float(data["experience_years"])
    if "rate_month" in data:
        v = data["rate_month"]
        cand.rate_month = float(v) if v is not None else None
    if "stack" in data and data["stack"] is not None:
        cand.stack = list(data["stack"])
    if "email" in data:
        cand.email = str(data["email"]) if data["email"] else None
    if "recruiter_id" in data and data["recruiter_id"] is not None:
        await _ensure_valid_recruiter_id(db, data["recruiter_id"])
    _apply_resume_patch(cand, data)
    try:
        await db.commit()
    except (IntegrityError, DataError) as e:
        await db.rollback()
        _raise_candidate_write_error(e)
    await db.refresh(cand)
    vmap = await _vacancy_ids_map(db, [cand.id])
    return cand, vmap[cand.id]


# ---------------------------------------------------------------------------
# Archive / restore / delete
# ---------------------------------------------------------------------------


async def archive_candidate(
    db: AsyncSession, user: User, cand_id: uuid.UUID, reason: str | None
) -> tuple[Candidate, list[uuid.UUID]]:
    _ensure_can_mutate(user)
    cand, vids = await get_candidate(db, cand_id)
    cand.archived = True
    cand.archived_at = datetime.now(timezone.utc)
    cand.archived_by_id = user.id
    cand.archive_reason = reason
    await db.commit()
    await db.refresh(cand)
    return cand, vids


async def restore_candidate(
    db: AsyncSession, user: User, cand_id: uuid.UUID
) -> tuple[Candidate, list[uuid.UUID]]:
    _ensure_can_mutate(user)
    cand, vids = await get_candidate(db, cand_id)
    cand.archived = False
    cand.archived_at = None
    cand.archived_by_id = None
    cand.archive_reason = None
    await db.commit()
    await db.refresh(cand)
    return cand, vids


async def delete_candidate(
    db: AsyncSession, user: User, cand_id: uuid.UUID, *, permanent: bool
) -> None:
    if permanent:
        _ensure_can_permanent_delete(user)
        cand, _ = await get_candidate(db, cand_id)
        await db.delete(cand)
    else:
        # Дефолтный DELETE без ?permanent=true = архивирование (как в моках)
        await archive_candidate(db, user, cand_id, reason=None)
        return
    await db.commit()


# ---------------------------------------------------------------------------
# Kanban / status
# ---------------------------------------------------------------------------


async def change_status(
    db: AsyncSession,
    user: User,
    cand_id: uuid.UUID,
    payload: ChangeCandidateStatusRequest,
) -> tuple[Candidate, list[uuid.UUID]]:
    _ensure_can_mutate(user)
    cand, _ = await get_candidate(db, cand_id)
    if cand.status != payload.status:
        before_status = cand.status.value
        cand.status = payload.status
        cand.status_changed_at = datetime.now(timezone.utc)
        peers = (
            await db.execute(_base_query().where(Candidate.status == payload.status))
        ).scalars().all()
        cand.kanban_order = _next_kanban_order(peers)
        await audit_service.record_audit(
            db,
            entity_type="candidate",
            entity_id=cand.id,
            actor_id=user.id,
            field="status",
            before=before_status,
            after=payload.status.value,
        )
        await audit_service.record_activity(
            db,
            entity_type=ActivityEntityType.candidate,
            entity_id=cand.id,
            actor_id=user.id,
            kind=ActivityKind.status,
            text=(
                f"Статус изменён: {before_status} → {payload.status.value}"
                + (f". {payload.comment}" if payload.comment else "")
            ),
        )
        # Уведомление рекрутеру кандидата, если статус сменил не он сам.
        if cand.recruiter_id != user.id:
            await notify_service.notify(
                db,
                recipient_id=cand.recruiter_id,
                kind=NotificationKind.status_change,
                text=f"Кандидат «{cand.full_name}»: статус {before_status} → {payload.status.value}",
                entity_type=NotificationEntityType.candidate,
                entity_id=cand.id,
            )
    await db.commit()
    await db.refresh(cand)
    vmap = await _vacancy_ids_map(db, [cand.id])
    return cand, vmap[cand.id]


async def reorder_kanban(
    db: AsyncSession, user: User, updates: list[CandidateKanbanUpdate]
) -> tuple[list[Candidate], dict[uuid.UUID, list[uuid.UUID]]]:
    _ensure_can_mutate(user)
    ids = [u.id for u in updates]
    if not ids:
        return [], {}
    rows = (
        await db.execute(_base_query().where(Candidate.id.in_(ids)))
    ).scalars().all()
    by_id = {c.id: c for c in rows}
    if len(by_id) != len(ids):
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Не все кандидаты найдены")
    now = datetime.now(timezone.utc)
    for upd in updates:
        cand = by_id[upd.id]
        if cand.status != upd.status:
            cand.status = upd.status
            cand.status_changed_at = now
        cand.kanban_order = upd.kanban_order
    await db.commit()
    for c in rows:
        await db.refresh(c)
    vmap = await _vacancy_ids_map(db, [c.id for c in rows])
    return list(rows), vmap
