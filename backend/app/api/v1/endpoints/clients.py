"""Эндпоинты /clients и вложенные /clients/{id}/contacts."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import OkResponse
from app.modules.clients import contacts_service, service
from app.modules.clients.models import Client as ClientModel
from app.modules.clients.models import ClientKind, ClientStatus, Contact as ContactModel
from app.modules.clients.schemas import (
    ClientPage,
    ClientResponse,
    ContactResponse,
    CreateClientRequest,
    CreateContactRequest,
    LegalEntityOut,
    UpdateClientRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/clients", tags=["clients"])


def _to_dto(client: ClientModel, counts: dict[str, int]) -> ClientResponse:
    return ClientResponse(
        id=client.id,
        name=client.name,
        legal_entities=[
            LegalEntityOut(id=le.id, name=le.name, inn=le.inn) for le in client.legal_entities
        ],
        industry=client.industry,
        account_manager_id=client.account_manager_id,
        status=client.status,
        client_kind=client.client_kind,
        telegram_chat=client.telegram_chat,
        vacancies_count=counts.get("vacancies_count", 0),
        contacts_count=counts.get("contacts_count", 0),
    )


def _contact_to_dto(contact: ContactModel) -> ContactResponse:
    return ContactResponse.model_validate(contact)


@router.get("", response_model=ClientPage, summary="Список клиентов")
async def list_clients(
    search: str | None = None,
    status_: ClientStatus | None = Query(default=None, alias="status"),
    account_manager_id: uuid.UUID | None = Query(default=None, alias="accountManagerId"),
    industry: str | None = None,
    client_kind: ClientKind | None = Query(default=None, alias="clientKind"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClientPage:
    clients, total, counts = await service.list_clients(
        db,
        user,
        search=search,
        status_=status_,
        account_manager_id=account_manager_id,
        industry=industry,
        client_kind=client_kind,
        page=page,
        page_size=page_size,
    )
    return ClientPage(
        items=[_to_dto(c, counts.get(c.id, {})) for c in clients],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=ClientResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать клиента",
)
async def create_client(
    payload: CreateClientRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClientResponse:
    client, counts = await service.create_client(db, user, payload)
    return _to_dto(client, counts)


@router.get("/{client_id}", response_model=ClientResponse, summary="Клиент по id")
async def get_client(
    client_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClientResponse:
    client, counts = await service.get_client(db, client_id, user)
    return _to_dto(client, counts)


@router.patch("/{client_id}", response_model=ClientResponse, summary="Обновить клиента")
async def update_client(
    client_id: uuid.UUID,
    payload: UpdateClientRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClientResponse:
    client, counts = await service.update_client(db, user, client_id, payload)
    return _to_dto(client, counts)


@router.delete("/{client_id}", response_model=OkResponse, summary="Удалить клиента (soft)")
async def delete_client(
    client_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    await service.delete_client(db, user, client_id)
    return OkResponse()


@router.get(
    "/{client_id}/contacts",
    response_model=list[ContactResponse],
    summary="Контакты клиента",
)
async def list_client_contacts(
    client_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ContactResponse]:
    contacts = await contacts_service.list_for_client(db, user, client_id)
    return [_contact_to_dto(c) for c in contacts]


@router.post(
    "/{client_id}/contacts",
    response_model=ContactResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить контакт клиенту",
)
async def add_client_contact(
    client_id: uuid.UUID,
    payload: CreateContactRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ContactResponse:
    contact = await contacts_service.create_contact(db, user, client_id, payload)
    return _contact_to_dto(contact)
