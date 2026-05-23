"""Конфиг разрешённых переходов статуса вакансии.

Источник истины — этот файл. Эндпоинт `GET /vacancies/transitions` возвращает
его «как есть» (после Pydantic-маппинга), чтобы UI мог нарисовать только
доступные кнопки и не пытаться отправить запрещённый переход.

Главное правило (см. План_перехода_на_API.docx §4 «Этап 4»):
> «Бизнес-правила переходов (которые сегодня нельзя из "Новая" сразу в
>  "Закрыта") — конфиг в БД».

На MVP конфиг живёт здесь; если потребуется кастомизация per-customer —
переедет в `vacancy_status_transitions` таблицу с тем же интерфейсом.
"""
from __future__ import annotations

from app.modules.vacancies.models import VacancyStatus
from app.modules.vacancies.models import VacancyStatus as V

# Полный список финальных статусов. Закрытие требует обязательного комментария
# (валидация в сервисе на смене статуса).
FINAL_STATUSES: frozenset[VacancyStatus] = frozenset({V.closed_success, V.closed})

# Куда можно перевести из каждого статуса. Любой → paused разрешён всегда;
# из paused — возврат в `in_work` или `new`.
_TRANSITIONS: dict[V, set[V]] = {
    V.new: {V.in_work, V.paused},
    V.in_work: {V.proposed, V.interview, V.waiting_os, V.closed, V.paused},
    V.proposed: {V.interview, V.in_work, V.closed, V.paused},
    V.interview: {V.waiting_os, V.closed, V.closed_success, V.in_work, V.paused},
    V.waiting_os: {V.closed_success, V.closed, V.interview, V.paused},
    V.closed_success: set(),  # терминальное состояние
    V.closed: {V.in_work},  # можно «переоткрыть»
    V.paused: {V.new, V.in_work},
}


def allowed_next(status: V) -> set[V]:
    return _TRANSITIONS.get(status, set())


def is_allowed(src: V, dst: V) -> bool:
    if src == dst:
        return True  # «остаться в текущем» (используется при PUT kanban-order без смены колонки)
    return dst in allowed_next(src)


def is_final(status: V) -> bool:
    return status in FINAL_STATUSES


def as_dict() -> dict[str, list[str]]:
    """Сериализуемое для JSON представление: { 'new': ['in_work', 'paused'], ... }."""
    return {src.value: sorted(dst.value for dst in dsts) for src, dsts in _TRANSITIONS.items()}
