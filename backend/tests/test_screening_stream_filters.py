"""Фильтры аудиопотока скрининга: эхо, галлюцинации Whisper, ранги статусов.

Юнит-тесты без БД и сети. Закрывают риски из «План_AI_скрининга.docx» (п.7):
рекрутер без наушников ловит голос кандидата из колонок (эхо → дубли в
транскрипте) и Whisper галлюцинирует на тишине.
"""
from __future__ import annotations

import asyncio

import pytest

from app.modules.screening.agent import _can_apply_status
from app.modules.screening.models import (
    ScreeningQuestionStatus as QS,
)
from app.modules.screening.models import (
    ScreeningSegment,
    ScreeningSpeaker,
)
from app.modules.screening.service import is_duplicate_segment, is_hallucination


def _seg(text: str, started: int, ended: int, speaker=ScreeningSpeaker.candidate):
    return ScreeningSegment(
        seq=1, speaker=speaker, text_=text, started_ms=started, ended_ms=ended
    )


def test_hallucination_filter():
    assert is_hallucination("Продолжение следует...")
    assert is_hallucination("Субтитры сделал DimaTorzok")
    assert is_hallucination("Подписывайтесь на канал!")
    assert is_hallucination("   ")
    assert is_hallucination("...")
    assert not is_hallucination("Работал с Kafka два года")


def test_echo_dedup_by_time_and_text():
    recent = [_seg("Я работал с Kafka два года", 1000, 4000)]
    # Эхо в микрофоне рекрутера: тот же текст, тот же интервал.
    assert is_duplicate_segment("Я работал с Kafka два года", 1100, 4200, recent)
    # Мелкие расхождения распознавания — тоже дубль.
    assert is_duplicate_segment("я работал с kafka, два года!", 1000, 4000, recent)
    # Другая реплика в том же интервале — не дубль.
    assert not is_duplicate_segment("А расскажите про мониторинг", 1000, 4000, recent)
    # Тот же текст сильно позже — кандидат действительно повторился.
    assert not is_duplicate_segment("Я работал с Kafka два года", 60000, 63000, recent)


def test_agent_cannot_downgrade_answered():
    # Главное: модель не должна снимать уже отвеченный вопрос в skipped.
    assert not _can_apply_status(QS.answered, QS.skipped)
    assert not _can_apply_status(QS.answered, QS.asked)
    assert _can_apply_status(QS.answered, QS.answered)  # обновление summary
    assert _can_apply_status(QS.pending, QS.skipped)
    assert _can_apply_status(QS.asked, QS.answered)


@pytest.mark.asyncio
async def test_pcm_queue_drops_oldest_on_overflow():
    """Backpressure к STT: очередь полна → выбрасываем самые старые кадры.

    Ждать место нельзя: `await send_pcm` в цикле чтения останавливал приём
    из сокета рекрутера целиком, пока STT разгребал очередь.
    """
    from app.api.v1.endpoints.screening_ws import _offer_pcm

    queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=2)
    assert _offer_pcm(queue, b"a") == 0
    assert _offer_pcm(queue, b"b") == 0
    assert _offer_pcm(queue, b"c") == 1  # "a" вытеснен
    assert _offer_pcm(queue, b"d") == 1  # "b" вытеснен

    assert queue.get_nowait() == b"c"
    assert queue.get_nowait() == b"d"
    assert queue.empty()
