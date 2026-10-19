"""Проверка доступа к сущности, к которой привязаны комментарии и файлы.

Комментарии (`/comments`) и файлы (`/files`) — «прицепные» данные: они
адресуются парой `(entity_type, entity_id)`. Раньше эти эндпоинты проверяли
только логин, и матрица прав обходилась через них: sales-менеджер без
`candidate:view` читал комментарии и резюме кандидатов, рекрутер — чужие лиды,
любой пользователь скачивал записи интервью скрининга.

`ensure_entity_access` повторяет правила видимости самой сущности (те же
сервисные функции, что у её карточки), поэтому права на «прицепные» данные
всегда совпадают с правами на карточку.

Импорты сервисов — ленивые: эти модули сами импортируют permissions.service.
"""
from __future__ import annotations

import uuid
from enum import Enum

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.permissions import service as permissions_service
from app.modules.users.models import User


def _value(entity_type: str | Enum) -> str:
    return entity_type.value if isinstance(entity_type, Enum) else str(entity_type)


async def ensure_entity_access(
    db: AsyncSession,
    user: User,
    entity_type: str | Enum,
    entity_id: uuid.UUID,
    *,
    write: bool = False,
) -> None:
    """403/404, если пользователь не видит сущность (или не может в неё писать).

    `write=True` — загрузка файла или новый комментарий. Для большинства
    сущностей достаточно права видеть карточку; исключения — записи
    скрининга (нужно `screening:run`) и вложения чата (см. files.service).
    """
    kind = _value(entity_type)

    if kind == "candidate":
        await permissions_service.require_action(
            db, user, "candidate:view", message="Нет доступа к кандидатам"
        )
        from app.modules.candidates import service as candidates_service

        await candidates_service.get_candidate(db, entity_id)
        return

    if kind == "vacancy":
        await permissions_service.require_action(
            db, user, "vacancy:view", message="Нет доступа к вакансиям"
        )
        from app.modules.vacancies import service as vacancies_service

        # get_vacancy: 404 для удалённых и ограничение «только свои» для AM.
        await vacancies_service.get_vacancy(db, user, entity_id)
        return

    if kind == "lead":
        from app.modules.leads import service as leads_service

        # get_lead: право lead:access + «только свои» для AM / sales.
        await leads_service.get_lead(db, user, entity_id)
        return

    if kind == "tender":
        from app.modules.tenders import service as tenders_service

        await tenders_service.get_tender(db, user, entity_id)
        return

    if kind == "client":
        from app.modules.clients import service as clients_service

        await clients_service.get_client(db, entity_id, user)
        return

    if kind in ("contact", "document"):
        # Контакты и база знаний доступны всем ролям (clients.view / документы).
        return

    if kind == "screening":
        from app.modules.screening import service as screening_service

        session = await screening_service._load(db, entity_id)
        await screening_service._ensure_can_see(db, user, session)
        if write:
            await permissions_service.require_action(
                db, user, screening_service.ACTION_RUN,
                message="Недостаточно прав на проведение скрининга",
            )
        elif not (
            await permissions_service.user_has_action(db, user, screening_service.ACTION_RUN)
            or await permissions_service.user_has_action(
                db, user, screening_service.ACTION_VIEW_REPORT
            )
        ):
            raise ApiError(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "Недостаточно прав на записи скрининга",
                details={"action": screening_service.ACTION_VIEW_REPORT},
            )
        return

    if kind == "chat_message":
        from app.modules.chat.models import ChatMember, ChatMessage

        msg = await db.get(ChatMessage, entity_id)
        if msg is None:
            if write:
                # Загрузка вложения до отправки: entity_id — свежий «черновой»
                # UUID, к сообщению файл привяжет post_message.
                return
            raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Сообщение не найдено")
        if write:
            # К уже отправленному (чужому или своему) сообщению файлы через
            # /files не цепляются — только через отправку сообщения.
            raise ApiError(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "Нельзя прикрепить файл к уже отправленному сообщению",
            )
        member = await db.get(ChatMember, (msg.conversation_id, user.id))
        if member is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Сообщение не найдено")
        return

    if kind == "hr_document":
        # Файлы кадрового ЭДО — только через /hr-edo/* (свои проверки и протокол).
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Файл не найден")

    raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "Нет доступа")
