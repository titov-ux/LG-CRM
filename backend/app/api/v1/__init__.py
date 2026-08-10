"""Сборщик роутеров v1."""
from fastapi import APIRouter

from app.api.v1.endpoints import (
    analytics,
    api_tokens,
    audit,
    auth,
    calendar,
    candidates,
    chat,
    clients,
    comments,
    contacts,
    documents,
    files,
    integrations,
    matching,
    notifications,
    permissions,
    realtime,
    screenings,
    telegram,
    tenders,
    users,
    vacancies,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(clients.router)
api_router.include_router(contacts.router)
api_router.include_router(documents.router)
api_router.include_router(vacancies.router)
api_router.include_router(tenders.router)
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
api_router.include_router(chat.router)
api_router.include_router(realtime.router)
api_router.include_router(integrations.router)
api_router.include_router(telegram.router)
api_router.include_router(api_tokens.router)
api_router.include_router(calendar.router)
api_router.include_router(screenings.router)
