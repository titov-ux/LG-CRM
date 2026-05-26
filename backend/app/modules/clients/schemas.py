"""DTO модуля clients (соответствует openapi.yaml + frontend/src/api/types.ts)."""
from __future__ import annotations

import uuid
from datetime import date

from pydantic import EmailStr, Field

from app.core.schemas import CamelModel
from app.modules.clients.models import ClientKind, ClientStatus


# ─── Legal entities ───
class LegalEntityIn(CamelModel):
    """В Update запросах фронт может прислать id (для существующих) либо без id (для новых)."""

    id: uuid.UUID | None = None
    name: str
    inn: str


class LegalEntityOut(CamelModel):
    id: uuid.UUID
    name: str
    inn: str


# ─── Clients ───
class ClientResponse(CamelModel):
    id: uuid.UUID
    name: str
    legal_entities: list[LegalEntityOut] = Field(default_factory=list)
    industry: str
    # nullable: если AM удалён, поле сбрасывается в null (см. миграцию 0011).
    account_manager_id: uuid.UUID | None = None
    status: ClientStatus
    client_kind: ClientKind
    telegram_chat: str | None = None
    vacancies_count: int = 0
    contacts_count: int = 0


class CreateClientRequest(CamelModel):
    name: str = Field(min_length=1)
    legal_entities: list[LegalEntityIn] = Field(default_factory=list)
    industry: str = ""
    # При создании AM опционален — клиента можно завести «без ответственного».
    account_manager_id: uuid.UUID | None = None
    status: ClientStatus = ClientStatus.lead
    client_kind: ClientKind = ClientKind.direct
    telegram_chat: str | None = None


class UpdateClientRequest(CamelModel):
    name: str | None = None
    legal_entities: list[LegalEntityIn] | None = None
    industry: str | None = None
    account_manager_id: uuid.UUID | None = None
    status: ClientStatus | None = None
    client_kind: ClientKind | None = None
    telegram_chat: str | None = None


# ─── Pagination wrapper (Page<Client>) ───
class ClientPage(CamelModel):
    items: list[ClientResponse]
    total: int
    page: int
    page_size: int


# ─── Contacts ───
class ContactBase(CamelModel):
    name: str = Field(min_length=1)
    role: str = ""
    email: EmailStr | None = None
    phone: str | None = None
    telegram: str | None = None
    birthday: date | None = None


class CreateContactRequest(ContactBase):
    pass


class ContactResponse(CamelModel):
    id: uuid.UUID
    client_id: uuid.UUID
    name: str
    role: str
    email: EmailStr | None = None
    phone: str | None = None
    telegram: str | None = None
    birthday: date | None = None


class ContactListItem(ContactResponse):
    client_name: str


class ContactPage(CamelModel):
    items: list[ContactListItem]
    total: int
    page: int
    page_size: int
