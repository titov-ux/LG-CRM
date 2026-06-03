"""Модель учёта времени сотрудников в системе — `work_sessions`.

Одна строка = один непрерывный интервал «пользователь онлайн в CRM». Сессия
открывается, когда юзер стал online (первый WS-коннект, `became_online`), и
закрывается, когда ушёл offline (последний коннект пропал, `became_offline`)
либо когда его подобрал presence-sweeper при падении воркера.

Presence (`app/realtime/presence.py`) эфемерен (Redis + TTL) и отвечает только
на вопрос «кто онлайн сейчас». Историю времени мы храним здесь, в Postgres,
переиспользуя те же события жизненного цикла WS-соединения.

`user_id` — FK на `users.id` с `SET NULL` + nullable (как миграция 0011),
чтобы удаление пользователя не блокировалось и не сносило накопленную историю.

`last_heartbeat_at` обновляется каждым HB-циклом WS (~раз в 30с). Он нужен,
чтобы «повисшие» сессии (воркер/сервер упал, штатный disconnect не отработал)
закрыть честным временем последней активности, а не временем обнаружения —
иначе в учёт попадёт мёртвый TTL-хвост.

Частичный unique-индекс `uq_work_sessions_open` гарантирует не больше одной
открытой сессии на пользователя — открытие идёт через `ON CONFLICT DO NOTHING`,
так что параллельные коннекты не плодят дубли.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampsMixin


class WorkSessionEndReason(str, enum.Enum):
    """Как сессия была закрыта — для отладки и доверия к данным."""

    disconnect = "disconnect"          # штатный разрыв последнего WS-коннекта
    sweep = "sweep"                    # presence-sweeper подобрал мёртвого юзера
    server_shutdown = "server_shutdown"  # реконсиляция на старте процесса
    reconcile = "reconcile"            # фоновая чистка устаревших открытых сессий


def _enum_values(e):
    return [m.value for m in e]


class WorkSession(Base, TimestampsMixin):
    __tablename__ = "work_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    last_heartbeat_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    end_reason: Mapped[WorkSessionEndReason | None] = mapped_column(
        Enum(
            WorkSessionEndReason,
            name="work_session_end_reason",
            values_callable=_enum_values,
        ),
        nullable=True,
    )
    # Денормализация длительности — для быстрых отчётов без вычитания дат.
    # Заполняется при закрытии: ended_at − started_at, в секундах.
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # === Активное время (Этап 3) =========================================
    # active_seconds — накопленное «активное» время внутри сессии: вкладка
    # видима И было взаимодействие. В отличие от online-времени (started→ended),
    # это сумма реальных интервалов активности. Растёт инкрементами по сигналам
    # `activity` от фронта; дедуплицируется между вкладками за счёт единого
    # last_active_at (см. worklog_service.record_activity).
    active_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    # Момент последнего сигнала активности. NULL — активности ещё не было.
    last_active_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # Не более одной открытой сессии на пользователя. Открытие — INSERT
        # ... ON CONFLICT DO NOTHING по этому индексу.
        Index(
            "uq_work_sessions_open",
            "user_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
        # Для агрегатов «время за период по сотруднику».
        Index("ix_work_sessions_user_started", "user_id", "started_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        state = "open" if self.ended_at is None else "closed"
        return f"<WorkSession {self.user_id} {state} {self.started_at}>"
