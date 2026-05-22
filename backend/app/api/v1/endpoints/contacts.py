"""Эндпоинты /contacts (плоский список и CRUD по id)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.clients import contacts_service
from app.modules.clients.models import Contact
from app.modules.clients.schemas import (
    ContactListItem,
    ContactPage,
    CreateContactRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/contacts", tags=["contacts"])


def _to_item(contact: Contact, client_name: str) -> ContactListItem:
    return ContactListItem(
        id=contact.id,
        client_id=contact.client_id,
        name=contact.name,
        role=contact.role,
        email=contact.email,
        phone=contact.phone,
        telegram=contact.telegram,
        birthday=contact.birthday,
        client_name=client_name,
    )


@router.get("", response_model=ContactPage, summary="Список контактов всех клиентов")
async def list_contacts(
    search: str | None = None,
    client_id: uuid.UUID | None = Query(default=None, alias="clientId"),
    has_email: bool | None = Query(default=None, alias="hasEmail"),
    has_phone: bool | None = Query(default=None, alias="hasPhone"),
    has_telegram: bool | None = Query(default=None, alias="hasTelegram"),
    has_birthday: bool | None = Query(default=None, alias="hasBirthday"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ContactPage:
    rows, total = await contacts_service.list_contacts(
        db,
        user,
        search=search,
        client_id=client_id,
        has_email=has_email,
        has_phone=has_phone,
        has_telegram=has_telegram,
        has_birthday=has_birthday,
        page=page,
        page_size=page_size,
    )
    return ContactPage(
        items=[_to_item(c, cn) for c, cn in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{contact_id}", response_model=ContactListItem, summary="Контакт по id")
async def get_contact(
    contact_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ContactListItem:
    contact, client_name = await contacts_service.get_contact(db, user, contact_id)
    return _to_item(contact, client_name)


@router.patch("/{contact_id}", response_model=ContactListItem, summary="Обновить контакт")
async def update_contact(
    contact_id: uuid.UUID,
    payload: CreateContactRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ContactListItem:
    contact, client_name = await contacts_service.update_contact(db, user, contact_id, payload)
    return _to_item(contact, client_name)


@router.delete("/{contact_id}", response_model=OkResponse, summary="Удалить контакт (soft)")
async def delete_contact(
    contact_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await contacts_service.delete_contact(db, user, contact_id)
    return OkResponse()
