"""Сервис /contacts (плоский список) и /clients/{id}/contacts.

`ContactListItem` = `Contact` + `client_name` (для отображения «Принадлежит:»
в UI). На бэке делаем JOIN.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.clients.models import Client, Contact
from app.modules.clients.schemas import CreateContactRequest
from app.modules.clients.service import _ensure_can_mutate, get_client
from app.modules.users.models import User


def _visible_join() -> Select:
    return (
        select(Contact, Client.name.label("client_name"))
        .join(Client, Contact.client_id == Client.id)
        .where(Contact.deleted_at.is_(None), Client.deleted_at.is_(None))
    )


def _scope_for_user(q: Select, user: User) -> Select:
    # Все роли видят контакты всех клиентов — как и сами карточки клиентов
    # (правило `clients.view` = всем ролям). Сужения по ответственному менеджеру нет.
    return q


async def list_contacts(
    db: AsyncSession,
    user: User,
    *,
    search: str | None,
    client_id: uuid.UUID | None,
    has_email: bool | None,
    has_phone: bool | None,
    has_telegram: bool | None,
    has_birthday: bool | None,
    page: int,
    page_size: int,
) -> tuple[list[tuple[Contact, str]], int]:
    q = _scope_for_user(_visible_join(), user)
    if client_id is not None:
        q = q.where(Contact.client_id == client_id)
    if has_email:
        q = q.where(Contact.email.is_not(None), Contact.email != "")
    if has_phone:
        q = q.where(Contact.phone.is_not(None), Contact.phone != "")
    if has_telegram:
        q = q.where(Contact.telegram.is_not(None), Contact.telegram != "")
    if has_birthday:
        q = q.where(Contact.birthday.is_not(None))
    if search:
        like = f"%{search.lower()}%"
        q = q.where(
            or_(
                func.lower(Contact.name).like(like),
                func.lower(Contact.role).like(like),
                func.lower(Client.name).like(like),
                func.lower(func.coalesce(Contact.email, "")).like(like),
                func.coalesce(Contact.phone, "").like(f"%{search}%"),
                func.lower(func.coalesce(Contact.telegram, "")).like(like),
            )
        )

    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    q = q.order_by(Contact.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(q)).all()
    return [(r[0], r[1]) for r in rows], int(total)


async def get_contact(
    db: AsyncSession, user: User, contact_id: uuid.UUID
) -> tuple[Contact, str]:
    q = _scope_for_user(_visible_join(), user).where(Contact.id == contact_id)
    row = (await db.execute(q)).first()
    if row is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Контакт не найден")
    return row[0], row[1]


async def list_for_client(
    db: AsyncSession, user: User, client_id: uuid.UUID
) -> list[Contact]:
    # Сначала проверяем доступ к клиенту.
    await get_client(db, client_id, user)
    res = await db.execute(
        select(Contact)
        .where(Contact.client_id == client_id, Contact.deleted_at.is_(None))
        .order_by(Contact.created_at.desc())
    )
    return list(res.scalars().all())


async def create_contact(
    db: AsyncSession,
    user: User,
    client_id: uuid.UUID,
    payload: CreateContactRequest,
) -> Contact:
    _ensure_can_mutate(user)
    client, _ = await get_client(db, client_id, user)
    contact = Contact(
        client_id=client.id,
        name=payload.name,
        role=payload.role,
        email=str(payload.email) if payload.email else None,
        phone=payload.phone or None,
        telegram=payload.telegram or None,
        birthday=payload.birthday,
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return contact


async def update_contact(
    db: AsyncSession,
    user: User,
    contact_id: uuid.UUID,
    payload: CreateContactRequest,
) -> tuple[Contact, str]:
    _ensure_can_mutate(user)
    contact, client_name = await get_contact(db, user, contact_id)
    # Прямое присваивание — обязательные поля в схеме всё равно валидируются.
    contact.name = payload.name
    contact.role = payload.role
    contact.email = str(payload.email) if payload.email else None
    contact.phone = payload.phone or None
    contact.telegram = payload.telegram or None
    contact.birthday = payload.birthday
    await db.commit()
    await db.refresh(contact)
    return contact, client_name


async def delete_contact(db: AsyncSession, user: User, contact_id: uuid.UUID) -> None:
    _ensure_can_mutate(user)
    contact, _ = await get_contact(db, user, contact_id)
    contact.deleted_at = datetime.now(timezone.utc)
    await db.commit()
