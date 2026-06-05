"""Доставка уведомлений в Telegram сразу после коммита транзакции.

Почему после коммита, а не внутри `notify()`:
  * если отправить во время транзакции, а та откатится — пользователь получит
    сообщение о событии, которого нет в БД;
  * отправлять синхронно в обработчике запроса — добавлять сетевую задержку
    Bot API к каждому действию.

Решение: `notify()` складывает (user_id, text) в `session.info['tg_outbox']`,
а слушатель события SQLAlchemy `after_commit` планирует fire-and-forget задачу
отправки в текущем event loop. На `after_rollback`/закрытии — outbox очищается.

Отправка делается отдельной короткоживущей сессией БД: на момент исполнения
задачи исходная сессия запроса уже может быть закрыта.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.integrations import telegram as tg_client
from app.modules.integrations import telegram_service

log = logging.getLogger(__name__)

_OUTBOX_KEY = "tg_outbox"


def enqueue(session, *, user_id, text: str) -> None:
    """Добавить уведомление в outbox текущей (sync) сессии.

    Вызывается из `notify()`. No-op, если бот не сконфигурирован — чтобы не
    тратить ресурсы там, где Telegram не используется (и в тестах).
    """
    if not telegram_service.is_configured():
        return
    session.info.setdefault(_OUTBOX_KEY, []).append((user_id, text))


async def _send_one(user_id, text: str) -> None:
    # Локальный импорт — избегаем цикла на этапе загрузки модулей.
    from app.db.session import SessionLocal
    from app.modules.users.models import User

    try:
        async with SessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None:
                log.warning("telegram: user %s not found — skip delivery", user_id)
                return
            if user.telegram_chat_id is None:
                log.info("telegram: user %s has no chat_id (not linked) — skip", user_id)
                return
            if not user.telegram_notifications_enabled:
                log.info("telegram: user %s disabled notifications — skip", user_id)
                return
            ok = await tg_client.send_message(user.telegram_chat_id, text)
            if ok:
                log.info("telegram: delivered notification to %s", user_id)
            else:
                log.error(
                    "telegram: send_message returned False for user %s "
                    "(see Bot API error above)",
                    user_id,
                )
    except Exception:  # noqa: BLE001 — доставка не должна ронять ничего
        log.exception("telegram: failed to deliver notification to %s", user_id)


@event.listens_for(Session, "after_commit")
def _flush_outbox_after_commit(session: Session) -> None:
    pending = session.info.pop(_OUTBOX_KEY, None)
    if not pending:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # Нет работающего loop (например, синхронный скрипт) — просто пропускаем.
        log.warning("telegram: no running loop, dropping %d message(s)", len(pending))
        return
    for user_id, text in pending:
        loop.create_task(_send_one(user_id, text))


@event.listens_for(Session, "after_rollback")
def _drop_outbox_after_rollback(session: Session) -> None:
    session.info.pop(_OUTBOX_KEY, None)
