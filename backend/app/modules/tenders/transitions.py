"""Конфиг разрешённых переходов статуса тендера.

Источник истины — этот файл. Эндпоинт `GET /tenders/transitions` возвращает его
«как есть», чтобы UI рисовал только доступные кнопки.

Пайплайн: Лид → Оценка → Заявка → На рассмотрении → Выигран / Проигран.
В «Проигран» можно уйти с любого рабочего этапа (отказались / не прошли).
"""
from __future__ import annotations

from app.modules.tenders.models import TenderStatus
from app.modules.tenders.models import TenderStatus as T

# Финальные статусы — перевод в них требует обязательного комментария
# (валидация в сервисе на смене статуса).
FINAL_STATUSES: frozenset[TenderStatus] = frozenset({T.won, T.lost})

_TRANSITIONS: dict[T, set[T]] = {
    T.lead: {T.evaluation, T.lost},
    T.evaluation: {T.bid, T.lead, T.lost},
    T.bid: {T.review, T.evaluation, T.lost},
    T.review: {T.won, T.lost, T.bid},
    T.won: set(),  # терминальное состояние
    T.lost: {T.lead},  # можно «переоткрыть»
}


def allowed_next(status: T) -> set[T]:
    return _TRANSITIONS.get(status, set())


def is_allowed(src: T, dst: T) -> bool:
    if src == dst:
        return True  # «остаться в текущем» (PUT kanban-order без смены колонки)
    return dst in allowed_next(src)


def is_final(status: T) -> bool:
    return status in FINAL_STATUSES


def as_dict() -> dict[str, list[str]]:
    return {src.value: sorted(dst.value for dst in dsts) for src, dsts in _TRANSITIONS.items()}
