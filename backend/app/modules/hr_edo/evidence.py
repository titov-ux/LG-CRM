"""Неизменяемый протокол кадрового ЭДО с хеш-цепочкой.

Каждое событие хранит `prev_hash` (хеш предыдущего события) и `hash` —
SHA-256 от канонического JSON своих полей плюс `prev_hash`. Цепочка одна на
весь протокол: вставка, правка или удаление любой записи ломает все хеши
после неё, и `verify_chain()` это ловит. Правку и удаление дополнительно
запрещает триггер Postgres (см. models.py и миграцию 0036).

Запись идёт под транзакционным advisory-lock: два параллельных запроса не
могут взять один и тот же `prev_hash` и разветвить цепочку.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hr_edo.models import HrDocEvent, HrEventKind

GENESIS_HASH = "0" * 64
# Произвольная константа для pg_advisory_xact_lock (int8) — «замок протокола».
_CHAIN_LOCK_KEY = 0x48524544_4F455654  # "HREDOEVT"


@dataclass(frozen=True)
class Actor:
    """Кто совершил действие. `type`: user | employee | system."""

    type: str
    name: str = ""
    user_id: uuid.UUID | None = None
    employee_id: uuid.UUID | None = None
    ip: str | None = None
    ua: str | None = None

    @classmethod
    def system(cls) -> Actor:
        return cls(type="system", name="Система")


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def compute_hash(
    *,
    prev_hash: str,
    kind: str,
    document_id: uuid.UUID | None,
    employee_id: uuid.UUID | None,
    actor_type: str,
    actor_user_id: uuid.UUID | None,
    actor_employee_id: uuid.UUID | None,
    actor_name: str,
    ip: str | None,
    ua: str | None,
    payload: dict[str, Any],
    created_at: datetime,
) -> str:
    body = {
        "prev": prev_hash,
        "kind": kind,
        "documentId": str(document_id) if document_id else None,
        "employeeId": str(employee_id) if employee_id else None,
        "actorType": actor_type,
        "actorUserId": str(actor_user_id) if actor_user_id else None,
        "actorEmployeeId": str(actor_employee_id) if actor_employee_id else None,
        "actorName": actor_name,
        "ip": ip,
        "ua": ua,
        "payload": payload,
        "createdAt": _iso(created_at),
    }
    return hashlib.sha256(_canonical(body).encode()).hexdigest()


def _event_hash(ev: HrDocEvent, prev_hash: str) -> str:
    kind = ev.kind.value if isinstance(ev.kind, HrEventKind) else str(ev.kind)
    return compute_hash(
        prev_hash=prev_hash,
        kind=kind,
        document_id=ev.document_id,
        employee_id=ev.employee_id,
        actor_type=ev.actor_type,
        actor_user_id=ev.actor_user_id,
        actor_employee_id=ev.actor_employee_id,
        actor_name=ev.actor_name,
        ip=ev.ip,
        ua=ev.ua,
        payload=dict(ev.payload or {}),
        created_at=ev.created_at,
    )


async def record_event(
    db: AsyncSession,
    *,
    kind: HrEventKind,
    actor: Actor,
    document_id: uuid.UUID | None = None,
    employee_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> HrDocEvent:
    """Добавить событие в протокол (flush, без commit — в транзакции действия)."""
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _CHAIN_LOCK_KEY})
    prev = (
        await db.execute(select(HrDocEvent.hash).order_by(HrDocEvent.id.desc()).limit(1))
    ).scalar_one_or_none() or GENESIS_HASH
    # JSON-нормализация: в хеш идёт ровно то, что вернёт JSONB при чтении.
    clean_payload: dict[str, Any] = json.loads(_canonical(payload or {}))
    created_at = datetime.now(timezone.utc)
    ua = (actor.ua or None) and actor.ua[:512]
    ev = HrDocEvent(
        document_id=document_id,
        employee_id=employee_id,
        kind=kind,
        actor_type=actor.type,
        actor_user_id=actor.user_id,
        actor_employee_id=actor.employee_id,
        actor_name=actor.name[:255],
        ip=actor.ip,
        ua=ua,
        payload=clean_payload,
        prev_hash=prev,
        created_at=created_at,
    )
    ev.hash = _event_hash(ev, prev)
    db.add(ev)
    await db.flush()
    return ev


@dataclass(frozen=True)
class ChainCheck:
    ok: bool
    checked: int
    broken_at_id: int | None = None
    reason: str | None = None
    last_hash: str | None = None


def verify_rows(rows: Iterable[HrDocEvent]) -> ChainCheck:
    """Проверить цепочку по уже прочитанным строкам (в порядке id)."""
    prev = GENESIS_HASH
    checked = 0
    for ev in rows:
        if ev.prev_hash != prev:
            return ChainCheck(False, checked, ev.id, "prev_hash_mismatch", prev)
        if _event_hash(ev, prev) != ev.hash:
            return ChainCheck(False, checked, ev.id, "hash_mismatch", prev)
        prev = ev.hash
        checked += 1
    return ChainCheck(True, checked, None, None, prev)


async def verify_chain(db: AsyncSession, *, batch: int = 2000) -> ChainCheck:
    """Полная сверка протокола (Celery beat `hr_edo.verify_event_chain`)."""
    prev = GENESIS_HASH
    checked = 0
    last_id = 0
    while True:
        rows: Sequence[HrDocEvent] = (
            (
                await db.execute(
                    select(HrDocEvent)
                    .where(HrDocEvent.id > last_id)
                    .order_by(HrDocEvent.id)
                    .limit(batch)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            return ChainCheck(True, checked, None, None, prev)
        for ev in rows:
            if ev.prev_hash != prev:
                return ChainCheck(False, checked, ev.id, "prev_hash_mismatch", prev)
            if _event_hash(ev, prev) != ev.hash:
                return ChainCheck(False, checked, ev.id, "hash_mismatch", prev)
            prev = ev.hash
            checked += 1
            last_id = ev.id
