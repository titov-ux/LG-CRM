"""Alembic env: async-friendly с подгрузкой URL из настроек приложения."""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import get_settings
from app.db.base import Base

# Import models so they get registered with Base.metadata.
# Дописываем импорты по мере появления моделей.
from app.modules.users.models import User  # noqa: F401
from app.modules.users.invites import PasswordInvite  # noqa: F401
from app.modules.permissions.models import PermissionRow  # noqa: F401
from app.modules.clients.models import Client, Contact, LegalEntity  # noqa: F401
from app.modules.vacancies.models import Vacancy, VacancyRecruiter  # noqa: F401
from app.modules.tenders.models import Tender  # noqa: F401
from app.modules.candidates.models import Candidate  # noqa: F401
from app.modules.matching.models import VacancyCandidate  # noqa: F401
from app.modules.comments.models import Comment  # noqa: F401
from app.modules.audit.models import ActivityEntry, AuditEntry  # noqa: F401
from app.modules.files.models import File  # noqa: F401
from app.modules.notifications.models import Notification  # noqa: F401
from app.modules.documents.models import (  # noqa: F401
    Document,
    DocumentComment,
    DocumentFavorite,
    DocumentVersion,
)
from app.modules.chat.models import (  # noqa: F401
    ChatConversation,
    ChatMember,
    ChatMessage,
    ChatMessageReaction,
)
from app.modules.integrations.models import IntegrationToken  # noqa: F401
from app.modules.users.api_tokens import UserApiToken  # noqa: F401
from app.modules.calendar.models import (  # noqa: F401
    CalendarEvent,
    CalendarEventAttendee,
)
from app.modules.analytics.worklog_models import WorkSession  # noqa: F401
from app.modules.screening.models import (  # noqa: F401
    ScreeningQuestion,
    ScreeningReport,
    ScreeningSegment,
    ScreeningSession,
)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", str(get_settings().database_url))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
