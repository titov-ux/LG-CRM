"""Realtime-агент вопросов во время скрининга (Этап 4).

На финальных сегментах транскрипта (дебаунс 5–10 с) вызывает YandexGPT:
отмечает отвеченные/заданные/пропущенные, добавляет follow-up, отдаёт
короткую подсказку рекрутеру. Результат уходит клиенту как
`questions.updated` / `hint` по WS.

Лимиты (токены/частота) — через Settings: debounce, min interval,
max calls/session, max follow-ups. Ошибки LLM глотаем: встреча не
должна падать из‑за AI.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.integrations.yandex_gpt import (
    AiBadRequestError,
    AiUnavailableError,
    YandexGptClient,
)
from app.modules.screening import metrics as screening_metrics
from app.modules.screening.models import (
    ScreeningQuestion,
    ScreeningQuestionSource,
    ScreeningQuestionStatus,
    ScreeningSegment,
    ScreeningSession,
    ScreeningStatus,
)
from app.modules.screening.schemas import ScreeningQuestionDTO

logger = logging.getLogger(__name__)

PROMPT_VERSION = "screening_agent_v1"
# Потолок ответа модели на один тик (входной промпт режется по
# YANDEX_AI_MAX_INPUT_CHARS). Учитывается в бюджете токенов сессии.
_TICK_MAX_TOKENS = 1200

_ALLOWED_STATUSES = frozenset({"asked", "answered", "skipped"})
# Ранги статусов: answered — самый «высокий», чтобы модель не могла пометить
# уже отвеченный вопрос как skipped (правило промпта кодом не удержать).
_STATUS_RANK = {
    ScreeningQuestionStatus.pending: 0,
    ScreeningQuestionStatus.asked: 1,
    ScreeningQuestionStatus.skipped: 2,
    ScreeningQuestionStatus.answered: 3,
}

EmitFn = Callable[[dict[str, Any]], Awaitable[None]]

AGENT_TICK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "question_updates": {
            "type": "array",
            "description": (
                "Обновления статусов существующих вопросов. "
                "Меняй только если по транскрипту ясно, что вопрос задан, "
                "на него ответили, или его стоит пропустить."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "UUID вопроса из чек-листа",
                    },
                    "status": {
                        "type": "string",
                        "enum": ["asked", "answered", "skipped"],
                    },
                    "answer_summary": {
                        "type": "string",
                        "description": (
                            "Краткое содержание ответа кандидата "
                            "(1–2 предложения). Обязательно при status=answered."
                        ),
                    },
                },
                "required": ["id", "status"],
                "additionalProperties": False,
            },
        },
        "followups": {
            "type": "array",
            "description": (
                "Новые уточняющие вопросы (0–2). Только если ответ кандидата "
                "открыл важный пробел или риск. Не дублируй уже стоящие в плане."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "goal": {"type": "string"},
                    "insert_after_id": {
                        "type": "string",
                        "description": (
                            "UUID вопроса, после которого вставить; "
                            "пустая строка — в конец списка."
                        ),
                    },
                },
                "required": ["text", "goal"],
                "additionalProperties": False,
            },
        },
        "hint": {
            "type": "string",
            "description": (
                "Короткая подсказка рекрутеру (что спросить / на что обратить "
                "внимание прямо сейчас). Пустая строка, если нечего сказать."
            ),
        },
    },
    "required": ["question_updates", "followups", "hint"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = """\
Ты — ассистент рекрутера на живом видеоскрининге. По свежему транскрипту \
обнови чек-лист вопросов.

Правила:
1. Статусы: asked — рекрутер уже задал; answered — кандидат дал содержательный \
ответ по сути; skipped — вопрос больше не нужен (уже закрыт другим ответом \
или нерелевантен). Не понижай статус (answered → asked нельзя).
2. При answered обязательно краткий answer_summary на русском (факт из ответа, \
без оценок «хорошо/плохо»).
3. followups — только точечные уточнения (обычно 0, максимум {max_followups}). \
Не раздувай план. Формулировки от лица рекрутера, на «вы».
4. hint — одна короткая фраза рекрутеру (или пустая строка). Без воды.
5. Не выдумывай факты, которых нет в транскрипте. Не трогай вопросы, по \
которым нет оснований.
6. id вопросов копируй точно из входного чек-листа.
"""


def _clean_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v or v.lower() in {"null", "none", "n/a"}:
        return None
    return v


def _parse_uuid(value: Any) -> uuid.UUID | None:
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value.strip())
    except (ValueError, AttributeError):
        return None


@dataclass
class AgentQuestionUpdate:
    id: uuid.UUID
    status: ScreeningQuestionStatus
    answer_summary: str | None = None


@dataclass
class AgentFollowup:
    text: str
    goal: str
    insert_after_id: uuid.UUID | None = None


@dataclass
class AgentTickResult:
    updates: list[AgentQuestionUpdate] = field(default_factory=list)
    followups: list[AgentFollowup] = field(default_factory=list)
    hint: str | None = None


def coerce_agent_tick(
    raw: dict[str, Any],
    *,
    known_ids: set[uuid.UUID],
    max_followups: int,
) -> AgentTickResult:
    """Нормализовать ответ модели → безопасный AgentTickResult."""
    updates: list[AgentQuestionUpdate] = []
    seen_upd: set[uuid.UUID] = set()
    raw_updates = raw.get("question_updates")
    if isinstance(raw_updates, list):
        for item in raw_updates:
            if not isinstance(item, dict):
                continue
            qid = _parse_uuid(item.get("id"))
            if qid is None or qid not in known_ids or qid in seen_upd:
                continue
            status_raw = _clean_str(item.get("status"))
            if status_raw not in _ALLOWED_STATUSES:
                continue
            status = ScreeningQuestionStatus(status_raw)
            summary = _clean_str(item.get("answer_summary"))
            if status == ScreeningQuestionStatus.answered and not summary:
                summary = "Ответ зафиксирован по транскрипту"
            if status != ScreeningQuestionStatus.answered:
                summary = None
            updates.append(
                AgentQuestionUpdate(id=qid, status=status, answer_summary=summary)
            )
            seen_upd.add(qid)

    followups: list[AgentFollowup] = []
    seen_text: set[str] = set()
    raw_fu = raw.get("followups")
    if isinstance(raw_fu, list):
        for item in raw_fu:
            if not isinstance(item, dict):
                continue
            text = _clean_str(item.get("text"))
            if not text:
                continue
            key = text.casefold()
            if key in seen_text:
                continue
            seen_text.add(key)
            goal = _clean_str(item.get("goal")) or "Уточнить ответ кандидата"
            after = _parse_uuid(item.get("insert_after_id"))
            if after is not None and after not in known_ids:
                after = None
            followups.append(
                AgentFollowup(text=text, goal=goal, insert_after_id=after)
            )
            if len(followups) >= max_followups:
                break

    hint = _clean_str(raw.get("hint"))
    if hint and len(hint) > 280:
        hint = hint[:277].rstrip() + "…"

    return AgentTickResult(updates=updates, followups=followups, hint=hint)


def _format_questions(questions: list[ScreeningQuestion]) -> str:
    lines: list[str] = []
    for q in sorted(questions, key=lambda x: x.position):
        goal = f" | цель: {q.goal}" if q.goal else ""
        ans = f" | ответ: {q.answer_summary}" if q.answer_summary else ""
        lines.append(
            f"- id={q.id} [{q.status.value}] ({q.source.value}) {q.text_}{goal}{ans}"
        )
    return "\n".join(lines) if lines else "(чек-лист пуст)"


def _format_segments(segments: list[ScreeningSegment]) -> str:
    lines: list[str] = []
    for s in segments:
        sp = "Рекрутер" if s.speaker.value == "recruiter" else "Кандидат"
        lines.append(f"[{s.seq}] {sp}: {s.text_}")
    return "\n".join(lines) if lines else "(нет новых реплик)"


def _question_dto(q: ScreeningQuestion) -> ScreeningQuestionDTO:
    return ScreeningQuestionDTO(
        id=q.id,
        position=q.position,
        text=q.text_,
        goal=q.goal,
        source=q.source,
        status=q.status,
        answer_summary=q.answer_summary,
    )


async def run_agent_tick(
    *,
    questions: list[ScreeningQuestion],
    segments: list[ScreeningSegment],
    max_followups: int,
) -> AgentTickResult:
    """Один вызов LLM. Может бросить AiUnavailable/AiBadRequest."""
    settings = get_settings()
    known = {q.id for q in questions}
    user_msg = (
        "=== ЧЕК-ЛИСТ ===\n"
        + _format_questions(questions)
        + "\n\n=== СВЕЖИЙ ТРАНСКРИПТ ===\n"
        + _format_segments(segments)
    )
    max_chars = settings.yandex_ai_max_input_chars
    if len(user_msg) > max_chars:
        user_msg = user_msg[-max_chars:]

    client = YandexGptClient()
    if not client.is_configured:
        raise AiUnavailableError("yandex gpt not configured")

    raw = await client.json_completion(
        system=_SYSTEM_PROMPT.format(max_followups=max_followups),
        user=user_msg,
        schema_name="screening_agent_tick",
        schema=AGENT_TICK_SCHEMA,
        max_tokens=_TICK_MAX_TOKENS,
        temperature=0.2,
    )
    return coerce_agent_tick(raw, known_ids=known, max_followups=max_followups)


def _can_apply_status(
    current: ScreeningQuestionStatus, new: ScreeningQuestionStatus
) -> bool:
    """Разрешаем только «вперёд» или same→answered с summary."""
    if new == current:
        return new == ScreeningQuestionStatus.answered
    return _STATUS_RANK[new] >= _STATUS_RANK[current] and new != current


async def apply_agent_tick(
    db: AsyncSession,
    session_id: uuid.UUID,
    result: AgentTickResult,
    *,
    max_followups_remaining: int,
) -> tuple[list[ScreeningQuestionDTO], int]:
    """Применить тик к БД.

    Возвращает (актуальный чек-лист, сколько follow-up реально добавлено) —
    бюджет follow-up нельзя списывать, пока вставка не произошла.
    """
    session = (
        await db.execute(
            select(ScreeningSession)
            .where(ScreeningSession.id == session_id)
            .options(selectinload(ScreeningSession.questions))
        )
    ).scalar_one_or_none()
    if session is None or session.status != ScreeningStatus.live:
        return [], 0

    by_id = {q.id: q for q in session.questions}
    changed = False

    for upd in result.updates:
        q = by_id.get(upd.id)
        if q is None:
            continue
        if not _can_apply_status(q.status, upd.status):
            continue
        if q.status != upd.status:
            q.status = upd.status
            changed = True
        if (
            upd.status == ScreeningQuestionStatus.answered
            and upd.answer_summary
            and upd.answer_summary != q.answer_summary
        ):
            q.answer_summary = upd.answer_summary
            changed = True

    followups = result.followups[: max(0, max_followups_remaining)]
    added_followups = 0
    if followups:
        positions = {q.id: q.position for q in session.questions}
        # Если несколько follow-up с одним insert_after_id — вставляем цепочкой.
        chain_tail: dict[uuid.UUID, uuid.UUID] = {}
        for fu in followups:
            after_id = fu.insert_after_id
            if after_id is not None:
                after_id = chain_tail.get(after_id, after_id)
            if after_id is not None and after_id in positions:
                anchor = positions[after_id]
                for q in session.questions:
                    if q.position > anchor:
                        q.position += 1
                for qid, pos in list(positions.items()):
                    if pos > anchor:
                        positions[qid] = pos + 1
                new_pos = anchor + 1
            else:
                new_pos = max(positions.values(), default=-1) + 1
            nq = ScreeningQuestion(
                id=uuid.uuid4(),
                position=new_pos,
                text_=fu.text,
                goal=fu.goal,
                source=ScreeningQuestionSource.followup,
                status=ScreeningQuestionStatus.pending,
            )
            session.questions.append(nq)
            by_id[nq.id] = nq
            positions[nq.id] = new_pos
            if fu.insert_after_id is not None:
                chain_tail[fu.insert_after_id] = nq.id
            added_followups += 1
            changed = True

    if changed:
        await db.commit()
        session = (
            await db.execute(
                select(ScreeningSession)
                .where(ScreeningSession.id == session_id)
                .options(selectinload(ScreeningSession.questions))
            )
        ).scalar_one()
    dtos = [
        _question_dto(q) for q in sorted(session.questions, key=lambda x: x.position)
    ]
    return dtos, added_followups


class ScreeningRealtimeAgent:
    """Дебаунс + лимиты + тик LLM на финальных сегментах одной WS-сессии."""

    def __init__(
        self, session_id: uuid.UUID, emit: EmitFn, *, start_seq: int = 0
    ) -> None:
        self.session_id = session_id
        self._emit = emit
        self._debounce_task: asyncio.Task[None] | None = None
        self._busy = False
        self._closed = False
        self._calls = 0
        self._failed_calls = 0
        self._tokens_spent = 0
        self._followups_added = 0
        self._last_call_mono = 0.0
        # Агент живёт на одно WS-соединение, а встреча переживает reconnect
        # (F5 у рекрутера). Стартуем с уже разобранного seq, иначе после
        # каждого переподключения агент перечитывает встречу с нуля и жжёт
        # лимит вызовов.
        start = max(0, int(start_seq))
        self._last_processed_seq = start
        self._newest_seq = start
        # Финалы, приехавшие пока тик был в полёте: тик их не увидит,
        # поэтому после его завершения планируем следующий.
        self._pending_final = False

    def notify_final(self, seq: int) -> None:
        if self._closed:
            return
        self._newest_seq = max(self._newest_seq, seq)
        settings = get_settings()
        if not settings.screening_ai_enabled:
            return
        if self._busy:
            # Тик исполняется ВНУТРИ _debounce_task: отменять её сейчас —
            # значит оборвать вызов LLM, за который уже списаны _calls,
            # _last_processed_seq и токены. Просто помечаем новые финалы,
            # следующий тик запланирует сам _tick в finally.
            self._pending_final = True
            return
        delay = max(1.0, float(settings.screening_ai_debounce_sec))
        self._cancel_debounce()
        self._debounce_task = asyncio.create_task(
            self._debounced_tick(delay), name=f"screening-agent-{self.session_id}"
        )

    async def close(self) -> None:
        self._closed = True
        self._pending_final = False
        task = self._debounce_task
        # Здесь отменяем безусловно (в т.ч. тик в полёте): встреча закончилась,
        # ждать ответ LLM больше некому.
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def _debounced_tick(self, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        if self._closed:
            return
        await self._tick()

    def _cancel_debounce(self) -> None:
        """Снять задачу дебаунса — только пока она безопасно спит.

        Нельзя отменять её, если внутри уже крутится _tick (вызов LLM) или
        если это текущая задача (_reschedule вызывается из самого _tick).
        """
        task = self._debounce_task
        if task is None or task.done():
            return
        if self._busy or task is asyncio.current_task():
            return
        task.cancel()

    def _reschedule(self, delay: float, suffix: str) -> None:
        """Перепланировать тик (агент занят / рано по min_interval)."""
        if self._closed:
            return
        self._cancel_debounce()
        self._debounce_task = asyncio.create_task(
            self._debounced_tick(max(0.5, delay)),
            name=f"screening-agent-{suffix}-{self.session_id}",
        )

    async def _tick(self) -> None:
        if self._closed:
            return
        settings = get_settings()
        if self._busy:
            # Предыдущий вызов LLM ещё в полёте: раньше тик просто терялся и
            # кусок транскрипта агент не видел никогда.
            self._reschedule(
                max(1.0, float(settings.screening_ai_min_interval_sec)), "busy"
            )
            return
        if not settings.screening_ai_enabled:
            return
        if (self._calls + self._failed_calls) >= settings.screening_ai_max_calls_per_session:
            logger.info(
                "screening.agent: call cap reached for %s (ok=%d, failed=%d)",
                self.session_id,
                self._calls,
                self._failed_calls,
            )
            return
        budget = int(getattr(settings, "screening_ai_token_budget", 0) or 0)
        if budget and self._tokens_spent >= budget:
            logger.info(
                "screening.agent: token budget spent for %s (~%d)",
                self.session_id,
                self._tokens_spent,
            )
            return
        now = time.monotonic()
        min_interval = max(0.0, float(settings.screening_ai_min_interval_sec))
        if self._last_call_mono and (now - self._last_call_mono) < min_interval:
            self._reschedule(min_interval - (now - self._last_call_mono), "retry")
            return
        if self._newest_seq <= self._last_processed_seq:
            return

        self._busy = True
        try:
            emit_questions: list[dict[str, Any]] | None = None
            emit_hint: str | None = None

            async with SessionLocal() as db:
                session = await db.get(ScreeningSession, self.session_id)
                if session is None or session.status != ScreeningStatus.live:
                    return

                questions = list(
                    (
                        await db.execute(
                            select(ScreeningQuestion)
                            .where(ScreeningQuestion.session_id == self.session_id)
                            .order_by(ScreeningQuestion.position.asc())
                        )
                    )
                    .scalars()
                    .all()
                )
                # Хвост транскрипта: дельта + небольшой контекст.
                tail = max(8, int(settings.screening_ai_transcript_tail))
                from_seq = max(0, self._last_processed_seq - 4)
                segs = list(
                    (
                        await db.execute(
                            select(ScreeningSegment)
                            .where(
                                ScreeningSegment.session_id == self.session_id,
                                ScreeningSegment.seq > from_seq,
                            )
                            .order_by(ScreeningSegment.seq.asc())
                            .limit(tail)
                        )
                    )
                    .scalars()
                    .all()
                )
                if not segs:
                    return

                fu_budget = max(
                    0,
                    settings.screening_ai_max_followups_per_session
                    - self._followups_added,
                )
                max_fu = min(settings.screening_ai_max_followups_per_tick, fu_budget)

                try:
                    result = await run_agent_tick(
                        questions=questions,
                        segments=segs,
                        max_followups=max_fu,
                    )
                except AiUnavailableError as exc:
                    logger.warning(
                        "screening.agent unavailable for %s: %s", self.session_id, exc
                    )
                    # Неудачные вызовы тоже жгут лимит: иначе при постоянных
                    # ошибках AI дёргается до конца встречи.
                    self._failed_calls += 1
                    self._last_call_mono = time.monotonic()
                    screening_metrics.record_ai_agent_unavailable()
                    return
                except AiBadRequestError as exc:
                    logger.error(
                        "screening.agent bad request for %s: %s", self.session_id, exc
                    )
                    self._failed_calls += 1
                    self._last_call_mono = time.monotonic()
                    screening_metrics.record_ai_agent_bad_request()
                    return

                self._calls += 1
                self._last_call_mono = time.monotonic()
                self._last_processed_seq = max(s.seq for s in segs)
                # Грубая оценка расхода: вход ≈ chars/4 + потолок ответа.
                self._tokens_spent += len(_format_segments(segs)) // 4 + _TICK_MAX_TOKENS
                screening_metrics.record_ai_agent_ok()

                dtos, applied_followups = await apply_agent_tick(
                    db,
                    self.session_id,
                    result,
                    max_followups_remaining=fu_budget,
                )
                self._followups_added += applied_followups

                if result.updates or applied_followups:
                    emit_questions = [
                        d.model_dump(by_alias=True, mode="json") for d in dtos
                    ]
                if result.hint:
                    emit_hint = result.hint

            if emit_questions is not None:
                await self._emit(
                    {"type": "questions.updated", "questions": emit_questions}
                )
            if emit_hint:
                await self._emit({"type": "hint", "text": emit_hint})
        except Exception:
            logger.exception("screening.agent tick failed for %s", self.session_id)
            # Голые Exception тоже жгут лимит вызовов — иначе при постоянных
            # сбоях (БД, сериализация) агент крутится до конца встречи.
            self._failed_calls += 1
            self._last_call_mono = time.monotonic()
            screening_metrics.record_ai_agent_error()
        finally:
            self._busy = False
            if self._pending_final and not self._closed:
                self._pending_final = False
                # Пока шёл вызов LLM, приехали новые финалы: планируем
                # следующий тик, но не раньше min_interval после этого вызова.
                min_interval = max(
                    0.0, float(get_settings().screening_ai_min_interval_sec)
                )
                since = (
                    time.monotonic() - self._last_call_mono
                    if self._last_call_mono
                    else min_interval
                )
                self._reschedule(min_interval - since, "pending")


__all__ = [
    "PROMPT_VERSION",
    "AGENT_TICK_SCHEMA",
    "AgentTickResult",
    "AgentQuestionUpdate",
    "AgentFollowup",
    "coerce_agent_tick",
    "run_agent_tick",
    "apply_agent_tick",
    "ScreeningRealtimeAgent",
]
