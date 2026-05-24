"""Бизнес-логика clients/legal_entities/contacts.

Видимость по ролям:
- admin / recruiter / viewer — все клиенты;
- account_manager — только клиенты, где он `account_manager_id`.

`vacancies_count` и `contacts_count` считаются на чтении — GROUP BY-подзапросы
в `_counts_for_clients` (фильтр `deleted_at IS NULL` для обоих). Денормализация
— когда нагрузка вырастет.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterable

from fastapi import status
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ApiError
from app.modules.clients.models import (
    Client,
    ClientKind,
    ClientStatus,
    Contact,
    LegalEntity,
)
from app.modules.clients.schemas import (
    CreateClientRequest,
    LegalEntityIn,
    UpdateClientRequest,
)
from app.modules.users.models import Role, User
from app.modules.vacancies.models import Vacancy

# ---------------------------------------------------------------------------
# Access control helpers
# ---------------------------------------------------------------------------


def _visible_clients_filter(user: User) -> list:
    """Фильтр SQLAlchemy для области видимости клиентов конкретной роли."""
    if user.role == Role.account_manager:
        return [Client.account_manager_id == user.id]
    return []


def _ensure_can_see(client: Client, user: User) -> None:
    if user.role == Role.account_manager and client.account_manager_id != user.id:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет доступа к клиенту")


def _ensure_can_mutate(user: User) -> None:
    """Создание/редактирование клиентов: admin и account_manager (правило clients.create_edit).

    Запреты на конкретного клиента (account_manager редактирует чужого) проверяются
    через `_ensure_can_see`.
    """
    if user.role not in (Role.admin, Role.account_manager):
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет прав на изменение клиента")


def _ensure_can_delete(user: User) -> None:
    """Удаление клиента — только admin (см. правило `clients.delete`)."""
    if user.role != Role.admin:
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Удаление доступно только админу")


# ---------------------------------------------------------------------------
# Counts (производные поля)
# ---------------------------------------------------------------------------


async def _counts_for_clients(
    db: AsyncSession, client_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, int]]:
    ids = list(client_ids)
    if not ids:
        return {}
    # contacts_count: только не удалённые
    contact_rows = (
        await db.execute(
            select(Contact.client_id, func.count(Contact.id))
            .where(Contact.client_id.in_(ids), Contact.deleted_at.is_(None))
            .group_by(Contact.client_id)
        )
    ).all()
    contacts_map = {cid: cnt for cid, cnt in contact_rows}
    # vacancies_count: только не удалённые (любой статус — закрытые/архивные
    # вакансии тоже должны учитываться: счётчик в списке клиентов отражает,
    # сколько всего вакансий когда-либо заводили в систему по клиенту).
    vacancy_rows = (
        await db.execute(
            select(Vacancy.client_id, func.count(Vacancy.id))
            .where(Vacancy.client_id.in_(ids), Vacancy.deleted_at.is_(None))
            .group_by(Vacancy.client_id)
        )
    ).all()
    vacancies_map = {cid: cnt for cid, cnt in vacancy_rows}
    return {
        cid: {
            "contacts_count": contacts_map.get(cid, 0),
            "vacancies_count": vacancies_map.get(cid, 0),
        }
        for cid in ids
    }


# ---------------------------------------------------------------------------
# CRUD clients
# ---------------------------------------------------------------------------


def _base_query() -> Select:
    return (
        select(Client)
        .where(Client.deleted_at.is_(None))
        .options(selectinload(Client.legal_entities))
    )


async def list_clients(
    db: AsyncSession,
    user: User,
    *,
    search: str | None = None,
    status_: ClientStatus | None = None,
    account_manager_id: uuid.UUID | None = None,
    industry: str | None = None,
    client_kind: ClientKind | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Client], int, dict[uuid.UUID, dict[str, int]]]:
    q = _base_query()
    for cond in _visible_clients_filter(user):
        q = q.where(cond)
    if status_ is not None:
        q = q.where(Client.status == status_)
    if account_manager_id is not None:
        q = q.where(Client.account_manager_id == account_manager_id)
    if industry:
        q = q.where(Client.industry == industry)
    if client_kind is not None:
        q = q.where(Client.client_kind == client_kind)
    if search:
        like = f"%{search.lower()}%"
        # Подзапрос: клиенты, у которых найдено совпадение по имени юр.лица или ИНН.
        legal_match = (
            select(LegalEntity.client_id).where(
                or_(
                    func.lower(LegalEntity.name).like(like),
                    LegalEntity.inn.like(f"%{search}%"),
                )
            )
        )
        q = q.where(
            or_(
                func.lower(Client.name).like(like),
                Client.id.in_(legal_match),
            )
        )

    # total
    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()

    q = q.order_by(Client.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    clients = list((await db.execute(q)).scalars().all())
    counts = await _counts_for_clients(db, [c.id for c in clients])
    return clients, int(total), counts


async def get_client(db: AsyncSession, client_id: uuid.UUID, user: User) -> tuple[Client, dict[str, int]]:
    client = (
        await db.execute(
            _base_query().where(Client.id == client_id)
        )
    ).scalar_one_or_none()
    if client is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Клиент не найден")
    _ensure_can_see(client, user)
    counts = (await _counts_for_clients(db, [client.id]))[client.id]
    return client, counts


async def create_client(
    db: AsyncSession, user: User, payload: CreateClientRequest
) -> tuple[Client, dict[str, int]]:
    _ensure_can_mutate(user)
    # account_manager не может назначить клиента на чужой ID — только на себя.
    if user.role == Role.account_manager and payload.account_manager_id != user.id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Аккаунт-менеджер может заводить клиентов только на себя",
        )
    client = Client(
        name=payload.name,
        industry=payload.industry,
        account_manager_id=payload.account_manager_id,
        status=payload.status,
        client_kind=payload.client_kind,
        telegram_chat=(payload.telegram_chat or "").strip() or None,
    )
    for le in payload.legal_entities:
        client.legal_entities.append(LegalEntity(name=le.name, inn=le.inn))
    db.add(client)
    await db.commit()
    await db.refresh(client, attribute_names=["legal_entities"])
    counts = (await _counts_for_clients(db, [client.id]))[client.id]
    return client, counts


async def update_client(
    db: AsyncSession,
    user: User,
    client_id: uuid.UUID,
    payload: UpdateClientRequest,
) -> tuple[Client, dict[str, int]]:
    _ensure_can_mutate(user)
    client, _ = await get_client(db, client_id, user)

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        client.name = data["name"]
    if "industry" in data and data["industry"] is not None:
        client.industry = data["industry"]
    if "account_manager_id" in data and data["account_manager_id"] is not None:
        # account_manager не может «передать» клиента другому — только админ.
        if user.role == Role.account_manager and data["account_manager_id"] != user.id:
            raise ApiError(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "Только админ может сменить ответственного менеджера",
            )
        client.account_manager_id = data["account_manager_id"]
    if "status" in data and data["status"] is not None:
        client.status = data["status"]
    if "client_kind" in data and data["client_kind"] is not None:
        client.client_kind = data["client_kind"]
    if "telegram_chat" in data:
        val = data["telegram_chat"]
        client.telegram_chat = (val or "").strip() or None
    if "legal_entities" in data and data["legal_entities"] is not None:
        _replace_legal_entities(client, payload.legal_entities or [])

    await db.commit()
    await db.refresh(client, attribute_names=["legal_entities"])
    counts = (await _counts_for_clients(db, [client.id]))[client.id]
    return client, counts


def _replace_legal_entities(client: Client, incoming: list[LegalEntityIn]) -> None:
    """Заменяет состав юр.лиц целиком — сохраняя существующие записи по id и удаляя лишние."""
    by_id = {le.id: le for le in client.legal_entities}
    kept: list[LegalEntity] = []
    for entry in incoming:
        if entry.id and entry.id in by_id:
            le = by_id[entry.id]
            le.name = entry.name
            le.inn = entry.inn
            kept.append(le)
        else:
            kept.append(LegalEntity(name=entry.name, inn=entry.inn))
    client.legal_entities = kept


async def delete_client(db: AsyncSession, user: User, client_id: uuid.UUID) -> None:
    _ensure_can_delete(user)
    client, _ = await get_client(db, client_id, user)
    from datetime import datetime, timezone

    client.deleted_at = datetime.now(timezone.utc)
    # Каскадный soft-delete контактов — для UI они должны исчезнуть.
    for contact in client.contacts:
        contact.deleted_at = client.deleted_at
    await db.commit()
