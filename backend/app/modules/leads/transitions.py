"""Конфиг разрешённых переходов статуса лида.

Источник истины — этот файл. Эндпоинт `GET /leads/transitions` возвращает его
«как есть», чтобы UI рисовал только доступные кнопки.

Пайплайн: Новый → Первый контакт → Квалифицирован → КП отправлено →
Переговоры → Сделка / Отказ. В отличие от тендера лид двигается между рабочими
этапами свободно (переговоры часто возвращаются на шаг КП, а «тёплый» лид может
сразу закрыться сделкой), поэтому из любого рабочего этапа доступны все
остальные рабочие + оба финальных.
"""
from __future__ import annotations

from app.modules.leads.models import LeadStatus
from app.modules.leads.models import LeadStatus as L

# Финальные статусы — перевод в них требует обязательного комментария
# (валидация в сервисе на смене статуса).
FINAL_STATUSES: frozenset[LeadStatus] = frozenset({L.won, L.lost})

_WORKING: tuple[L, ...] = (L.new, L.contacted, L.qualified, L.proposal, L.negotiation)

_TRANSITIONS: dict[L, set[L]] = {
    **{s: ({*_WORKING} - {s}) | FINAL_STATUSES for s in _WORKING},
    L.won: set(),  # терминальное состояние
    L.lost: {L.new},  # можно «переоткрыть»
}


def allowed_next(status: L) -> set[L]:
    return _TRANSITIONS.get(status, set())


def is_allowed(src: L, dst: L) -> bool:
    if src == dst:
        return True  # «остаться в текущем» (PUT kanban-order без смены колонки)
    return dst in allowed_next(src)


def is_final(status: L) -> bool:
    return status in FINAL_STATUSES


def as_dict() -> dict[str, list[str]]:
    return {src.value: sorted(dst.value for dst in dsts) for src, dsts in _TRANSITIONS.items()}
