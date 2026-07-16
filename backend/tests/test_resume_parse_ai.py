"""Тесты chunked-парсинга больших резюме (modules/candidates/ai.py).

Большое HH-резюме (10+ страниц) не влезает в один вызов yandexgpt (контекст
32к токенов, а «дословный» JSON-выход почти зеркалит вход), поэтому парсер
режет его на «шапку+хвост» и чанки мест работы. Здесь проверяем сплиттер,
упаковку чанков и склейку результатов через monkeypatch json_completion.
"""
from __future__ import annotations

import pytest

from app.modules.candidates import ai


def _hh_resume(jobs: int = 10, bullets_per_job: int = 12) -> str:
    """Синтетическая HH-выгрузка: шапка, N мест работы, хвост."""
    head = (
        "Малышев Александр\n"
        "Евгеньевич\n"
        "Мужчина, 45 лет, родился 15 июня 1981\n"
        "+7 (903) 5872930\n"
        "snml@mail.ru — предпочитаемый способ связи\n"
        "Проживает: Москва, м. Аэропорт\n"
        "Желаемая должность и зарплата\n"
        "System Architect\n"
        "395 000 ₽ на руки\n"
        "Опыт работы — 24 года 7 месяцев\n"
    )
    entries = []
    months = [
        "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
    ]
    for i in range(jobs):
        bullets = "\n".join(
            f"- пункт обязанностей номер {j}, достаточно длинный, чтобы чанк был увесистым"
            for j in range(bullets_per_job)
        )
        entries.append(
            f"{months[i % 12]} {2023 - i} —\n{months[(i + 3) % 12]} {2024 - i}\n"
            f"Компания №{i}\nМосква, example{i}.ru\nДолжность №{i}\n{bullets}\n"
            f"Технологии: Java, PostgreSQL\n"
        )
    tail = (
        "Образование\n"
        "Высшее\n2003\nУральский федеральный университет\n"
        "Навыки\n"
        "Знание языков Русский — Родной\n"
        "Дополнительная информация\n"
        "Обо мне 16 лет опыта с Java.\n"
    )
    return head + "\n".join(entries) + tail


# === Сплиттер ================================================================


def test_split_hh_resume_finds_head_entries_tail():
    text = _hh_resume(jobs=5)
    split = ai._split_hh_resume(text)
    assert split is not None
    head, entries, tail = split
    # Заголовок секции опыта остаётся в шапке — из него берётся experienceYears.
    assert "Опыт работы — 24 года 7 месяцев" in head
    assert "System Architect" in head
    assert len(entries) == 5
    assert "Компания №0" in entries[0]
    assert "Компания №4" in entries[4]
    # Хвост начинается с «Образование» и содержит «Обо мне».
    assert tail.startswith("Образование")
    assert "Обо мне" in tail


def test_split_hh_resume_ignores_industry_line():
    """«Повышение квалификации, переквалификация» (индустрия места работы)
    не должна открывать хвост — хвост открывает только полная строка-заголовок."""
    text = _hh_resume(jobs=2).replace(
        "Компания №1\n",
        "Компания №1\nОбразовательные учреждения\n"
        "Повышение квалификации, переквалификация\n",
    )
    split = ai._split_hh_resume(text)
    assert split is not None
    _, entries, tail = split
    assert len(entries) == 2
    assert "переквалификация" in entries[1]
    assert tail.startswith("Образование")


def test_split_hh_resume_none_for_non_hh_text():
    assert ai._split_hh_resume("Просто произвольный текст без структуры") is None


def test_normalize_resume_text_collapses_spaces():
    raw = (
        "Иргалин   Наир   Рафкатович\n"
        "\n"
        "Опыт   работы   — 3   года   7   месяцев\n"
        "Февраль   2026   —\n"
        "настоящее   время\n"
        "Банк   ВТБ\n"
        "Образование\n"
        "Магистр\n"
    )
    cleaned = ai._normalize_resume_text(raw)
    assert "Иргалин Наир Рафкатович" in cleaned
    assert "Опыт работы — 3 года 7 месяцев" in cleaned
    assert "  " not in cleaned
    split = ai._split_hh_resume(cleaned)
    assert split is not None
    head, entries, tail = split
    assert "Опыт работы — 3 года 7 месяцев" in head
    assert len(entries) == 1
    assert "Банк ВТБ" in entries[0]
    assert tail.startswith("Образование")


def test_split_hh_resume_tolerates_spaced_section_headers():
    """Даже без полной нормализации сплиттер должен видеть «Опыт   работы»."""
    text = (
        "Иванов Иван\n"
        "Опыт   работы   — 3 года\n"
        "Январь 2023 —\nнастоящее время\nКомпания А\nИнженер\n"
        "Дополнительная   информация\n"
        "Обо мне текст\n"
    )
    split = ai._split_hh_resume(text)
    assert split is not None
    head, entries, tail = split
    assert "Опыт   работы" in head
    assert len(entries) == 1
    assert "Компания А" in entries[0]
    assert "Дополнительная" in tail


# === Chunked-парсинг (по одному месту работы на вызов) ======================


async def test_parse_resume_text_big_resume_is_chunked(monkeypatch):
    text = _hh_resume(jobs=10, bullets_per_job=22)
    assert len(text) > ai._CHUNK_THRESHOLD_CHARS

    calls: list[dict] = []

    async def fake_json_completion(self, **kwargs):
        calls.append(kwargs)
        if kwargs["schema_name"] == "parsed_candidate_header":
            return {
                "fullName": "Малышев Александр Евгеньевич",
                "role": "System Architect",
                "experienceYears": 24,
                "rateMonth": 395000,
                "location": "Москва",
                "languages": [{"language": "Русский", "level": "родной"}],
            }
        # Вызов опыта: по одному месту работы на каждую «Компанию» во фрагменте.
        user = kwargs["user"]
        jobs = [
            {
                "company": f"Компания №{i}",
                "position": f"Должность №{i}",
                "startMonth": "2020-01",
                "endMonth": "2021-01",
                "achievements": ["пункт"],
                "stack": ["Java"],
            }
            for i in range(10)
            if f"Компания №{i}\n" in user
        ]
        return {"experience": jobs}

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )

    parsed = await ai.parse_resume_text(text, today="2026-07-02")

    header_calls = [c for c in calls if c["schema_name"] == "parsed_candidate_header"]
    exp_calls = [c for c in calls if c["schema_name"] == "parsed_candidate_experience"]
    assert len(header_calls) == 1
    # Одно место работы = один вызов. Группировать нельзя: yandexgpt на чанках
    # с несколькими местами возвращал не все (5 из 12 на реальном резюме).
    assert len(exp_calls) == 10
    for call in exp_calls:
        companies = [i for i in range(10) if f"Компания №{i}\n" in call["user"]]
        assert len(companies) == 1, "во фрагменте должно быть ровно одно место работы"
    # В header-вызов не должно попасть тело опыта, но должен попасть хвост.
    assert "пункт обязанностей" not in header_calls[0]["user"]
    assert "Обо мне" in header_calls[0]["user"]
    # Схема header-вызова — без experience.
    assert "experience" not in header_calls[0]["schema"]["properties"]

    # Склейка: ВСЕ 10 мест работы, в исходном порядке.
    assert parsed["fullName"] == "Малышев Александр Евгеньевич"
    assert [e["company"] for e in parsed["experience"]] == [
        f"Компания №{i}" for i in range(10)
    ]
    assert parsed["experienceYears"] == 24


async def test_parse_resume_text_retries_empty_entry_once(monkeypatch):
    """Ленивый пустой ответ модели на место работы повторяется один раз."""
    text = _hh_resume(jobs=10, bullets_per_job=22)
    exp_call_users: list[str] = []

    async def fake_json_completion(self, **kwargs):
        if kwargs["schema_name"] == "parsed_candidate_header":
            return {"fullName": "Малышев Александр Евгеньевич"}
        exp_call_users.append(kwargs["user"])
        # Первый вызов по «Компании №3» — лениво пустой, повтор — с данными.
        if "Компания №3\n" in kwargs["user"]:
            if exp_call_users.count(kwargs["user"]) == 1:
                return {}
        i = next(j for j in range(10) if f"Компания №{j}\n" in kwargs["user"])
        return {
            "experience": [
                {"company": f"Компания №{i}", "position": f"Должность №{i}"}
            ]
        }

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )

    parsed = await ai.parse_resume_text(text, today="2026-07-02")
    # 10 мест + 1 повтор.
    assert len(exp_call_users) == 11
    assert [e["company"] for e in parsed["experience"]] == [
        f"Компания №{i}" for i in range(10)
    ]


async def test_parse_resume_text_small_resume_single_call(monkeypatch):
    text = "Иванов Иван\nОпыт работы — 3 года\nЯнварь 2022 —\nООО Ромашка\nРазработчик"
    calls: list[dict] = []

    async def fake_json_completion(self, **kwargs):
        calls.append(kwargs)
        return {"fullName": "Иванов Иван"}

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )

    parsed = await ai.parse_resume_text(text, today="2026-07-02")
    assert parsed["fullName"] == "Иванов Иван"
    assert len(calls) == 1
    assert calls[0]["schema_name"] == "parsed_candidate"


async def test_parse_resume_text_big_non_hh_falls_back_to_single_call(monkeypatch):
    # Большой текст без HH-структуры — не должен падать, идёт одним вызовом.
    text = "просто много текста без структуры " * 1000
    assert len(text) > ai._CHUNK_THRESHOLD_CHARS
    calls: list[dict] = []

    async def fake_json_completion(self, **kwargs):
        calls.append(kwargs)
        return {}

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )

    parsed = await ai.parse_resume_text(text, today="2026-07-02")
    assert parsed == {}
    assert len(calls) == 1
    # Вход обрезан по yandex_ai_max_input_chars.
    from app.core.config import get_settings

    assert len(calls[0]["user"]) <= get_settings().yandex_ai_max_input_chars


async def test_parse_resume_text_chunk_error_propagates(monkeypatch):
    text = _hh_resume(jobs=10, bullets_per_job=22)

    async def fake_json_completion(self, **kwargs):
        if kwargs["schema_name"] == "parsed_candidate_experience":
            raise ai.AiUnavailableError("boom")
        return {}

    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.json_completion",
        fake_json_completion,
    )
    monkeypatch.setattr(
        "app.integrations.yandex_gpt.YandexGptClient.is_configured",
        property(lambda self: True),
    )

    with pytest.raises(ai.AiUnavailableError):
        await ai.parse_resume_text(text, today="2026-07-02")
