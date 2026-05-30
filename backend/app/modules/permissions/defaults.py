"""Дефолтная матрица прав.

Источник дублирует `frontend/src/lib/permissions-data.ts:DEFAULT_PERMISSIONS`.
При изменении правила нужно править оба файла (или сгенерировать из общего
yaml — задел на будущее).

Используется только для:
* первичного сидирования (`scripts/seed_permissions.py`),
* `POST /permissions-matrix/reset` (полный откат к дефолтам).
"""
from __future__ import annotations

from typing import TypedDict


class DefaultPermission(TypedDict):
    id: str
    group: str
    permission: str
    description: str
    actions: list[str]
    matrix: dict[str, bool]


# Все 4 роли упоминаются явно — иначе фронт получит частичный словарь и UI
# нарисует неопределённый чекбокс.
_ALL_ON: dict[str, bool] = {"admin": True, "account_manager": True, "recruiter": True, "viewer": True}
_ADMIN_ONLY: dict[str, bool] = {"admin": True, "account_manager": False, "recruiter": False, "viewer": False}


DEFAULT_PERMISSIONS: list[DefaultPermission] = [
    {
        "id": "clients.view",
        "group": "Клиенты",
        "permission": "Просмотр карточек клиентов",
        "description": "Доступ к списку и карточкам клиентов.",
        "actions": [],
        "matrix": dict(_ALL_ON),
    },
    {
        "id": "clients.create_edit",
        "group": "Клиенты",
        "permission": "Создание и редактирование",
        "description": "Создавать, изменять данные клиентов и контакты.",
        "actions": ["client:create", "client:edit"],
        "matrix": {"admin": True, "account_manager": True, "recruiter": False, "viewer": False},
    },
    {
        "id": "clients.delete",
        "group": "Клиенты",
        "permission": "Удаление / архив",
        "description": "Перевод клиентов в архив или удаление.",
        "actions": [],
        "matrix": dict(_ADMIN_ONLY),
    },
    {
        "id": "vacancies.view_all",
        "group": "Вакансии",
        "permission": "Просмотр всех вакансий",
        "description": "Видеть все вакансии компании, а не только свои.",
        "actions": [],
        "matrix": dict(_ALL_ON),
    },
    {
        "id": "vacancies.create_edit",
        "group": "Вакансии",
        "permission": "Создание / редактирование",
        "description": "Заводить новые вакансии и менять их статусы.",
        "actions": ["vacancy:create", "vacancy:edit", "vacancy:change_status"],
        "matrix": {"admin": True, "account_manager": True, "recruiter": True, "viewer": False},
    },
    {
        "id": "vacancies.assign_recruiter",
        "group": "Вакансии",
        "permission": "Назначение рекрутера",
        "description": "Распределять рекрутеров по вакансиям.",
        "actions": ["vacancy:assign_recruiter"],
        "matrix": {"admin": True, "account_manager": True, "recruiter": True, "viewer": False},
    },
    {
        "id": "candidates.view",
        "group": "Кандидаты",
        "permission": "Просмотр базы кандидатов",
        "description": "Поиск и фильтрация кандидатов.",
        "actions": [],
        "matrix": dict(_ALL_ON),
    },
    {
        "id": "candidates.create_edit",
        "group": "Кандидаты",
        "permission": "Создание / редактирование",
        "description": "Добавлять и редактировать карточки кандидатов.",
        "actions": ["candidate:create", "candidate:edit", "candidate:change_status"],
        "matrix": {"admin": True, "account_manager": False, "recruiter": True, "viewer": False},
    },
    {
        "id": "candidates.present",
        "group": "Кандидаты",
        "permission": "Презентация клиенту",
        "description": "Отправлять подборку кандидатов клиенту.",
        "actions": [],
        "matrix": {"admin": True, "account_manager": True, "recruiter": True, "viewer": False},
    },
    {
        "id": "candidates.archive",
        "group": "Кандидаты",
        "permission": "Убрать с канбан-доски",
        "description": (
            "Скрыть кандидата с канбан-доски. Кандидат остаётся в общей «Базе кандидатов»."
        ),
        "actions": ["candidate:archive"],
        "matrix": {"admin": True, "account_manager": True, "recruiter": True, "viewer": False},
    },
    {
        "id": "candidates.delete_permanent",
        "group": "Кандидаты",
        "permission": "Удаление из базы",
        "description": (
            "Полное удаление кандидата из базы без возможности восстановления. "
            "Действует поверх «убрать с доски»."
        ),
        "actions": ["candidate:delete_permanent"],
        "matrix": dict(_ADMIN_ONLY),
    },
    {
        "id": "calendar.view",
        "group": "Календарь",
        "permission": "Доступ к календарю",
        "description": "Видеть события календаря и собеседования.",
        "actions": [],
        "matrix": dict(_ALL_ON),
    },
    {
        "id": "calendar.manage",
        "group": "Календарь",
        "permission": "Создание / редактирование событий",
        "description": "Назначать собеседования, переносить и отмечать их исход.",
        "actions": ["event:create", "event:edit", "event:set_outcome"],
        "matrix": {"admin": True, "account_manager": True, "recruiter": True, "viewer": False},
    },
    {
        "id": "calendar.delete",
        "group": "Календарь",
        "permission": "Удаление событий",
        "description": "Удалять события календаря.",
        "actions": ["event:delete"],
        "matrix": {"admin": True, "account_manager": True, "recruiter": False, "viewer": False},
    },
    {
        "id": "analytics.view",
        "group": "Аналитика",
        "permission": "Доступ к аналитике",
        "description": "Доступ к разделу «Аналитика» и выгрузкам.",
        "actions": ["analytics:view"],
        "matrix": {"admin": True, "account_manager": True, "recruiter": False, "viewer": True},
    },
    {
        "id": "audit.view",
        "group": "Администрирование",
        "permission": "Журнал действий",
        "description": "Просмотр аудит-логов изменений.",
        "actions": ["audit:view"],
        "matrix": dict(_ADMIN_ONLY),
    },
    {
        "id": "users.manage",
        "group": "Администрирование",
        "permission": "Управление пользователями",
        "description": "Создание сотрудников, выдача ролей и доступов.",
        "actions": ["user:manage"],
        "matrix": dict(_ADMIN_ONLY),
    },
]


def clone_defaults() -> list[DefaultPermission]:
    """Глубокая копия — чтобы внешний код не мутировал общий объект."""
    return [
        {
            "id": p["id"],
            "group": p["group"],
            "permission": p["permission"],
            "description": p["description"],
            "actions": list(p["actions"]),
            "matrix": dict(p["matrix"]),
        }
        for p in DEFAULT_PERMISSIONS
    ]
