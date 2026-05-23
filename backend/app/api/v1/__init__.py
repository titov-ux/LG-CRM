"""Сборщик роутеров v1."""
from fastapi import APIRouter

from app.api.v1.endpoints import (
    analytics,
    audit,
    auth,
    candidates,
    clients,
    comments,
    contacts,
    files,
    matching,
    notifications,
    permissions,
    users,
    vacancies,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(clients.router)
api_router.include_router(contacts.router)
api_router.include_router(vacancies.router)
api_router.include_router(candidates.router)
api_router.include_router(matching.matches_router)
api_router.include_router(matching.vacancy_matches_router)
api_router.include_router(comments.router)
api_router.include_router(notifications.router)
api_router.include_router(files.router)
api_router.include_router(audit.router)
api_router.include_router(audit.activity_router)
api_router.include_router(analytics.router)
api_router.include_router(permissions.router)
