"""Unit-тесты realtime-агента скрининга (Этап 4, без сети)."""
from __future__ import annotations

import uuid

from app.modules.screening.agent import coerce_agent_tick
from app.modules.screening.models import ScreeningQuestionStatus


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
