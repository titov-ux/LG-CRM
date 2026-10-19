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

# Рабочая воронка вакансии по порядку этапов.
PIPELINE: tuple[VacancyStatus, ...] = (V.new, V.in_work, V.proposed, V.interview, V.waiting_os)

# Переходы ВПЕРЁД по воронке (и в финальные статусы). Любой → paused разрешён
# всегда; из paused — возврат в `in_work` или `new`.
_FORWARD: dict[V, set[V]] = {
    V.new: {V.in_work, V.paused},
    V.in_work: {V.proposed, V.interview, V.waiting_os, V.closed, V.paused},
    V.proposed: {V.interview, V.closed, V.paused},
    V.interview: {V.waiting_os, V.closed, V.closed_success, V.paused},
    V.waiting_os: {V.closed_success, V.closed, V.paused},
    V.closed_success: set(),  # терминальное состояние
    V.closed: {V.in_work},  # можно «переоткрыть»
    V.paused: {V.new, V.in_work},
}


def _with_rollback(forward: dict[V, set[V]]) -> dict[V, set[V]]:
    """Добавить откат на любой ПРЕДЫДУЩИЙ этап воронки.

    Раньше назад можно было только частично (например, из «Интервью» — лишь в
    «В работе»), и случайный клик по следующему статусу нельзя было отменить:
    из «Интервью» не вернуть «Кандидаты предложены». Ограничения вперёд
    (нельзя из «Новой» сразу закрыть и т.п.) не меняются.
    """
    result = {src: set(dsts) for src, dsts in forward.items()}
    for i, src in enumerate(PIPELINE):
        result[src] |= set(PIPELINE[:i])
    return result


_TRANSITIONS: dict[V, set[V]] = _with_rollback(_FORWARD)


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
