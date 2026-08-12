"""Unit-тесты realtime-агента скрининга (Этап 4, без сети)."""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest

from app.core.config import get_settings
from app.modules.screening import agent as agent_mod
from app.modules.screening.agent import AgentTickResult, coerce_agent_tick
from app.modules.screening.models import (
    ScreeningQuestionStatus,
    ScreeningSegment,
    ScreeningSession,
    ScreeningSpeaker,
    ScreeningStatus,
)


def test_coerce_agent_tick_filters_and_caps():
    q1 = uuid.uuid4()
    q2 = uuid.uuid4()
    unknown = uuid.uuid4()
    raw = {
        "question_updates": [
            {
                "id": str(q1),
                "status": "answered",
                "answer_summary": "  Работал с Kafka 2 года ",
            },
            {"id": str(q1), "status": "asked"},  # дубль id → drop
            {"id": str(unknown), "status": "answered", "answer_summary": "x"},
            {"id": "not-a-uuid", "status": "asked"},
            {"id": str(q2), "status": "pending"},  # недопустимый статус
            {"id": str(q2), "status": "asked"},
            {"id": str(uuid.uuid4()), "status": "answered"},  # без summary → дефолт, но id unknown
        ],
        "followups": [
            {"text": " Уточните про Kafka ", "goal": "Стек", "insert_after_id": str(q1)},
            {"text": "Уточните про Kafka", "goal": "дубль"},
            {"text": "", "goal": "x"},
            {"text": "Какой формат?", "goal": None},
            {"text": "Лишний третий", "goal": "cap"},
        ],
        "hint": "  Спросите про он-колл  ",
    }

    result = coerce_agent_tick(raw, known_ids={q1, q2}, max_followups=2)
    assert len(result.updates) == 2
    assert result.updates[0].id == q1
    assert result.updates[0].status == ScreeningQuestionStatus.answered
    assert result.updates[0].answer_summary == "Работал с Kafka 2 года"
    assert result.updates[1].id == q2
    assert result.updates[1].status == ScreeningQuestionStatus.asked
    assert result.updates[1].answer_summary is None

    assert len(result.followups) == 2
    assert result.followups[0].text == "Уточните про Kafka"
    assert result.followups[0].insert_after_id == q1
    assert result.followups[1].goal == "Уточнить ответ кандидата"
    assert result.hint == "Спросите про он-колл"


def test_coerce_answered_without_summary_gets_default():
    qid = uuid.uuid4()
    result = coerce_agent_tick(
        {
            "question_updates": [{"id": str(qid), "status": "answered"}],
            "followups": [],
            "hint": "",
        },
        known_ids={qid},
        max_followups=2,
    )
    assert result.updates[0].answer_summary == "Ответ зафиксирован по транскрипту"
    assert result.hint is None


# --- дебаунс/лимиты: тик в полёте и старт с ненулевого seq --------------------


class _Rows:
    """Ответ execute(): .scalars().all() — снимок на момент вызова."""

    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> "_Rows":
        return self

    def all(self) -> list[Any]:
        return list(self._rows)


class _FakeDb:
    """SessionLocal() для _tick: get(сессия) + execute(вопросы, затем сегменты)."""

    def __init__(self, session: Any, questions: list[Any], segments: list[Any]) -> None:
        self._session = session
        self._batches = [questions, segments]

    async def __aenter__(self) -> "_FakeDb":
        return self

    async def __aexit__(self, *_exc: Any) -> bool:
        return False

    async def get(self, *_a: Any, **_kw: Any) -> Any:
        return self._session

    async def execute(self, *_a: Any, **_kw: Any) -> _Rows:
        return _Rows(self._batches.pop(0) if self._batches else [])


def _segment(seq: int) -> ScreeningSegment:
    return ScreeningSegment(
        seq=seq,
        speaker=ScreeningSpeaker.candidate,
        text_=f"реплика {seq}",
        started_ms=seq * 1000,
        ended_ms=seq * 1000 + 900,
    )


async def _noop_emit(_msg: dict[str, Any]) -> None:
    return None


def _fast_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "screening_ai_enabled", True)
    monkeypatch.setattr(settings, "screening_ai_debounce_sec", 0.05)
    monkeypatch.setattr(settings, "screening_ai_min_interval_sec", 0.05)


@pytest.mark.asyncio
async def test_new_final_does_not_cancel_tick_in_flight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Финал во время вызова LLM не рвёт тик, а планирует следующий.

    Раньше notify_final отменял _debounce_task, внутри которой и крутился
    _tick: на живом диалоге вызов почти никогда не доживал до ответа, хотя
    лимиты (_calls, _last_processed_seq, токены) уже были списаны.
    """
    _fast_limits(monkeypatch)
    segments = [_segment(1)]
    session = ScreeningSession(status=ScreeningStatus.live)
    monkeypatch.setattr(
        agent_mod, "SessionLocal", lambda: _FakeDb(session, [], segments)
    )

    started = asyncio.Event()
    release = asyncio.Event()
    calls: list[list[int]] = []

    async def _slow_tick(*, questions, segments, max_followups):  # noqa: ANN001
        calls.append([s.seq for s in segments])
        started.set()
        await release.wait()
        return AgentTickResult()

    async def _apply(_db, _sid, _result, **_kw):  # noqa: ANN001
        return [], 0

    monkeypatch.setattr(agent_mod, "run_agent_tick", _slow_tick)
    monkeypatch.setattr(agent_mod, "apply_agent_tick", _apply)

    ag = agent_mod.ScreeningRealtimeAgent(uuid.uuid4(), _noop_emit)
    try:
        ag.notify_final(1)
        await asyncio.wait_for(started.wait(), 3.0)
        assert ag._busy

        started.clear()
        segments.append(_segment(2))
        ag.notify_final(2)
        # Задача с тиком в полёте осталась живой.
        assert ag._busy
        assert ag._debounce_task is not None and not ag._debounce_task.done()

        release.set()
        # Первый тик доехал до конца, второй запланирован из finally.
        await asyncio.wait_for(started.wait(), 3.0)
        for _ in range(100):
            if ag._calls >= 2:
                break
            await asyncio.sleep(0.02)

        assert calls == [[1], [1, 2]]
        assert ag._calls == 2
        assert ag._last_processed_seq == 2
    finally:
        release.set()
        await ag.close()


@pytest.mark.asyncio
async def test_agent_starts_from_last_seq(monkeypatch: pytest.MonkeyPatch) -> None:
    """После реконнекта агент продолжает с уже разобранного seq, а не с нуля."""
    _fast_limits(monkeypatch)

    def _no_db():
        raise AssertionError("тик не должен ходить в БД: новых финалов нет")

    async def _no_llm(**_kw):
        raise AssertionError("вызова LLM быть не должно")

    monkeypatch.setattr(agent_mod, "SessionLocal", _no_db)
    monkeypatch.setattr(agent_mod, "run_agent_tick", _no_llm)

    ag = agent_mod.ScreeningRealtimeAgent(uuid.uuid4(), _noop_emit, start_seq=42)
    assert ag._last_processed_seq == 42
    assert ag._newest_seq == 42

    # Финал из уже разобранного хвоста (дубль после F5) курсор не двигает.
    ag.notify_final(40)
    assert ag._newest_seq == 42
    await ag._tick()
    assert ag._calls == 0
    await ag.close()
