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
from app.modules.permissions import service as permissions_service
from app.modules.candidates.schemas import (
    CandidateKanbanUpdate,
    ChangeCandidateStatusRequest,
    CreateCandidateRequest,
    UpdateCandidateRequest,
)
from app.modules.matching.models import VacancyCandidate
from app.modules.users.models import Role, User
from app.modules.vacancies.models import EngagementType
from app.realtime.events import publish_candidate_changed

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


ACTION_CREATE = "candidate:create"
ACTION_EDIT = "candidate:edit"
ACTION_CHANGE_STATUS = "candidate:change_status"
ACTION_ARCHIVE = "candidate:archive"
ACTION_DELETE_PERMANENT = "candidate:delete_permanent"

_ACTION_MESSAGES = {
    ACTION_CREATE: "Нет прав на создание кандидата",
    ACTION_EDIT: "Нет прав на редактирование кандидата",
    ACTION_CHANGE_STATUS: "Нет прав на смену статуса кандидата",
    ACTION_ARCHIVE: "Нет прав убирать кандидата с канбан-доски",
    ACTION_DELETE_PERMANENT: "Нет прав на полное удаление кандидата",
}


async def _ensure_can(db: AsyncSession, user: User, action: str) -> None:
    """Проверка права по permissions_matrix, а не по захардкоженной роли.

    Раньше здесь стояло `user.role not in (admin, recruiter)`: матрица прав в
    админке ни на что не влияла, и account_manager получал 403 даже когда админ
    включал ему галочку «Кандидаты → Создание / редактирование». Теперь
    источник правды один — матрица (как в модуле screening).
    """
    if not await permissions_service.user_has_action(db, user, action):
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            _ACTION_MESSAGES.get(action, "Недостаточно прав"),
            details={"action": action},
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
    vacancy_id: uuid.UUID | None = None,
    archived: bool | str | None = False,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Candidate], int, dict[uuid.UUID, list[uuid.UUID]]]:
    q = _base_query()
    # PERF: фильтр «только прикреплённые к этой вакансии» — раньше карточка
    # вакансии тащила первую страницу /candidates (до 50) и фильтровала на
    # фронте по c.vacancyIds.includes(vacancyId). Это и баг (>50 — пропадали),
    # и лишний трафик. Теперь фильтр на бэке через EXISTS на vacancy_candidates.
    if vacancy_id is not None:
        q = q.where(
            VacancyCandidate.candidate_id == Candidate.id,
        ).where(VacancyCandidate.vacancy_id == vacancy_id)
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
    await _ensure_can(db, user, ACTION_CREATE)
    # Рекрутер опционален — кандидата можно завести без ответственного.
    if payload.recruiter_id is not None:
        await _ensure_valid_recruiter_id(db, payload.recruiter_id)

    # Дубль-чек по email/phone.
    duplicate: Candidate | None = None
    if payload.email:
        duplicate = (
            await db.execute(_base_query().where(Candidate.email == str(payload.email)))
        ).scalars().first()
    if duplicate is None and payload.phone:
        duplicate = (
            await db.execute(_base_query().where(Candidate.phone == payload.phone))
        ).scalars().first()
    if duplicate is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "duplicate_candidate",
            "Кандидат с таким email или телефоном уже есть в базе",
            details={"existingCandidateId": str(duplicate.id)},
        )

    # PERF: kanban_order — в конец колонки. Раньше тянули все карточки колонки
    # ради вычисления max(kanban_order); при 500+ кандидатов в одной колонке это
    # был самый дорогой шаг создания. Теперь один SELECT max() — БД отвечает за
    # миллисекунды независимо от размера колонки.
    max_order = (
        await db.execute(
            select(func.max(Candidate.kanban_order))
            .where(Candidate.deleted_at.is_(None))
            .where(Candidate.status == payload.status)
        )
    ).scalar()
    order = (max_order + 1) if isinstance(max_order, int) else 0

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
    publish_candidate_changed("created", id=cand.id, actor_id=user.id)
    return cand, []


async def update_candidate(
    db: AsyncSession, user: User, cand_id: uuid.UUID, payload: UpdateCandidateRequest
) -> tuple[Candidate, list[uuid.UUID]]:
    await _ensure_can(db, user, ACTION_EDIT)
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
    # Допускаем null: «отвязать» рекрутера — валидный сценарий.
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
    publish_candidate_changed("updated", id=cand.id, actor_id=user.id)
    return cand, vmap[cand.id]


# ---------------------------------------------------------------------------
# Archive / restore / delete
# ---------------------------------------------------------------------------


async def archive_candidate(
    db: AsyncSession, user: User, cand_id: uuid.UUID, reason: str | None
) -> tuple[Candidate, list[uuid.UUID]]:
    await _ensure_can(db, user, ACTION_ARCHIVE)
    cand, vids = await get_candidate(db, cand_id)
    cand.archived = True
    cand.archived_at = datetime.now(timezone.utc)
    cand.archived_by_id = user.id
    cand.archive_reason = reason
    await db.commit()
    await db.refresh(cand)
    publish_candidate_changed("archived", id=cand.id, actor_id=user.id)
    return cand, vids


async def restore_candidate(
    db: AsyncSession, user: User, cand_id: uuid.UUID
) -> tuple[Candidate, list[uuid.UUID]]:
    await _ensure_can(db, user, ACTION_ARCHIVE)
    cand, vids = await get_candidate(db, cand_id)
    cand.archived = False
    cand.archived_at = None
    cand.archived_by_id = None
    cand.archive_reason = None
    await db.commit()
    await db.refresh(cand)
    publish_candidate_changed("restored", id=cand.id, actor_id=user.id)
    return cand, vids


async def delete_candidate(
    db: AsyncSession, user: User, cand_id: uuid.UUID, *, permanent: bool
) -> None:
    if permanent:
        await _ensure_can(db, user, ACTION_DELETE_PERMANENT)
        cand, _ = await get_candidate(db, cand_id)
        await db.delete(cand)
        await db.commit()
        publish_candidate_changed("deleted", id=cand_id, actor_id=user.id)
        return
    # Дефолтный DELETE без ?permanent=true = архивирование (как в моках)
    await archive_candidate(db, user, cand_id, reason=None)
    return


# ---------------------------------------------------------------------------
# Kanban / status
# ---------------------------------------------------------------------------


async def change_status(
    db: AsyncSession,
    user: User,
    cand_id: uuid.UUID,
    payload: ChangeCandidateStatusRequest,
) -> tuple[Candidate, list[uuid.UUID]]:
    await _ensure_can(db, user, ACTION_CHANGE_STATUS)
    cand, _ = await get_candidate(db, cand_id)
    if cand.status != payload.status:
        before_status = cand.status.value
        cand.status = payload.status
        cand.status_changed_at = datetime.now(timezone.utc)
        # PERF: тянем только max(kanban_order) для целевой колонки вместо всех
        # карточек колонки. На канбане с 500+ карточек это сократило change_status
        # с десятков мс до single-digit-ms.
        max_order = (
            await db.execute(
                select(func.max(Candidate.kanban_order))
                .where(Candidate.deleted_at.is_(None))
                .where(Candidate.status == payload.status)
            )
        ).scalar()
        cand.kanban_order = (max_order + 1) if isinstance(max_order, int) else 0
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
        # recruiter_id может быть None после удаления пользователя (FK SET NULL) —
        # тогда уведомлять некого, просто пропускаем.
        if cand.recruiter_id is not None and cand.recruiter_id != user.id:
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
    publish_candidate_changed("status_changed", id=cand.id, actor_id=user.id)
    return cand, vmap[cand.id]


async def reorder_kanban(
    db: AsyncSession, user: User, updates: list[CandidateKanbanUpdate]
) -> tuple[list[Candidate], dict[uuid.UUID, list[uuid.UUID]]]:
    await _ensure_can(db, user, ACTION_CHANGE_STATUS)
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
    # PERF: db.refresh() в цикле = N запросов к БД (по одному на каждую карточку).
    # Для drag-n-drop канбана это становится узким местом: батч из 20 карточек
    # = 20 SELECT'ов после COMMIT. Все поля, которые меняются здесь
    # (status / status_changed_at / kanban_order), уже в инстансах — refresh
    # ради «триггеров на стороне БД» не нужен (их у нас нет).
    vmap = await _vacancy_ids_map(db, [c.id for c in rows])
    publish_candidate_changed(
        "reordered",
        ids=[c.id for c in rows],
        actor_id=user.id,
    )
    return list(rows), vmap
