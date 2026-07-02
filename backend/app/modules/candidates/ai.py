"""AI-распознавание резюме (сплошной текст из PDF) → структурированные поля формы кандидата.

Используем YandexGPT через `app.integrations.yandex_gpt`. Модель вызывается с
`response_format=json_schema` — она ОБЯЗАНА вернуть JSON по нашей схеме.

Контракт ответа (см. фронт `frontend/src/api/types.ts:Candidate`):

    interface ParsedCandidate {
      fullName?:        string
      role?:            string                    // желаемая должность
      grade?:           'Junior'|'Middle'|'Senior'|'Lead'
      experienceYears?: number
      format?:          'Удалённо'|'Гибрид'|'Офис'
      rateMonth?:       number                   // ожидаемая ставка ₽/мес
      location?:        string
      birthday?:        string                   // YYYY-MM-DD
      telegram?:        string
      phone?:           string
      email?:           string
      stack?:           string                   // CSV-список технологий
      summary?:         string                   // 'Обо мне'
      skillCategories?: { name: string; items: string[] }[]
      experience?:      { company; position; startMonth; endMonth?; project?; achievements[]; stack[] }[]
      education?:       { degree; institution; city?; graduationYear; specialty? }[]
      certifications?:  { title; issuer; period? }[]
      languages?:       { language; level: LanguageLevel }[]
    }

Все поля опциональны: модель должна возвращать только то, что явно есть в тексте.
Если ничего не распозналось — пустой объект.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date
from typing import Any

from app.core.config import get_settings
from app.integrations.yandex_gpt import (
    AiBadRequestError,
    AiTruncatedJsonError,
    AiUnavailableError,
    YandexGptClient,
)
from app.modules.vacancies.models import Grade, WorkFormat

logger = logging.getLogger(__name__)

# Регэксп для извлечения первой ISO-даты из произвольной строки.
_ISO_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
# YYYY-MM (для startMonth/endMonth).
_ISO_MONTH_RE = re.compile(r"(\d{4})-(\d{1,2})$")

_GRADE_VALUES: set[str] = {g.value for g in Grade}
_FORMAT_VALUES: set[str] = {f.value for f in WorkFormat}
_LANGUAGE_LEVELS: tuple[str, ...] = ("A1", "A2", "B1", "B2", "C1", "C2", "родной")
_LANGUAGE_LEVELS_SET: set[str] = set(_LANGUAGE_LEVELS)


# ─── JSON schema для structured output ──────────────────────────────────────
# Описания важны — модель смотрит на них, чтобы понять, какие значения «правильные».

_SKILL_CATEGORY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": (
                "Название блока навыков из резюме: 'Языки программирования', "
                "'Технологии', 'DevOps и автоматизация' и т.п. Если категорий "
                "явных нет — используй 'Ключевые навыки'. ЯВНОЕ ИСКЛЮЧЕНИЕ: "
                "НЕ создавай категорию для естественных языков (Русский, "
                "Английский, ...) — они идут отдельно в `languages`."
            ),
        },
        "items": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Конкретные технологии/навыки этой категории, каждый отдельной "
                "строкой. Сохраняй каноничные имена ('PostgreSQL', не 'postgres'). "
                "НЕ включай естественные языки (Русский, Английский, ...) — "
                "владение языками парсится отдельно в поле `languages`."
            ),
        },
    },
    "additionalProperties": False,
}

_EXPERIENCE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "company": {"type": "string", "description": "Название компании."},
        "position": {"type": "string", "description": "Должность в этой компании."},
        "startMonth": {
            "type": "string",
            "description": (
                "Дата начала работы в формате YYYY-MM (например, '2022-05'). "
                "День не указывается."
            ),
        },
        "endMonth": {
            "type": "string",
            "description": (
                "Дата окончания работы в формате YYYY-MM. Если в резюме указано "
                "'по настоящее время' / 'till now' / 'present' — оставь пустую строку."
            ),
        },
        "project": {
            "type": "string",
            "description": "Краткое описание проекта/продукта, если упомянуто.",
        },
        "achievements": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "ВСЕ буллеты под должностью одним массивом — и обязанности, и пункты "
                "из отдельного блока 'Достижения:'. НЕ выкидывай обычные обязанности "
                "только потому, что они не помечены как 'достижение'. НЕ обобщай и "
                "не пересказывай — переноси каждый пункт ДОСЛОВНО как в резюме. "
                "Если в резюме на этом месте работы 8 пунктов — здесь должно быть 8. "
                "Текст — на русском: если резюме на другом языке, переведи каждый "
                "пункт на русский полностью (см. правило 2 системного промпта). "
                "Без префиксов '—', '•', '-' — просто текст пункта."
            ),
        },
        "stack": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Технологии, использовавшиеся на этом месте работы. Если в резюме "
                "выделен 'Стек' — берёшь оттуда; иначе — пусто."
            ),
        },
    },
    "additionalProperties": False,
}

_EDUCATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "degree": {
            "type": "string",
            "description": "Уровень: 'Высшее', 'Магистр', 'Бакалавр', 'Специалист', 'Среднее' и т.п.",
        },
        "institution": {"type": "string", "description": "Название вуза/учебного заведения."},
        "city": {"type": "string", "description": "Город учебного заведения, если указан."},
        "graduationYear": {
            "type": "integer",
            "description": "Год окончания (4 цифры). Если интервал — берём год окончания.",
        },
        "specialty": {"type": "string", "description": "Факультет / специальность."},
    },
    "additionalProperties": False,
}

_CERTIFICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Название курса/сертификата."},
        "issuer": {"type": "string", "description": "Кто провёл/выдал (организация, школа)."},
        "period": {
            "type": "string",
            "description": "Свободный период: '2023', '2017-2025', 'Январь 2024'.",
        },
    },
    "additionalProperties": False,
}

_LANGUAGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "language": {
            "type": "string",
            "description": "Название языка: 'Русский', 'Английский', 'Немецкий', ...",
        },
        "level": {
            "type": "string",
            "enum": list(_LANGUAGE_LEVELS),
            "description": (
                "Уровень: A1/A2/B1/B2/C1/C2 или 'родной'. "
                "Соответствие словесных уровней HH: 'Начальный'→A1, "
                "'Элементарный'→A2, 'Средний'→B1, 'Средне-продвинутый'→B2, "
                "'Продвинутый'→C1, 'В совершенстве/Свободный'→C2, "
                "'Родной'→'родной'."
            ),
        },
    },
    "additionalProperties": False,
}

PARSED_CANDIDATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "fullName": {
            "type": "string",
            "description": (
                "Полное ФИО кандидата (Фамилия Имя Отчество, если есть). "
                "Резюме HH часто прячет ФИО в шапке — посмотри также в блоке "
                "'Комментарии к резюме' (там рекрутер обычно его указывает)."
            ),
        },
        "role": {
            "type": "string",
            "description": (
                "Желаемая должность (специализация). Берётся из секции "
                "'Желаемая должность и зарплата' / 'Desired position and salary'. "
                "Без названия компании и без пояснений."
            ),
        },
        "grade": {
            "type": "string",
            "enum": [g.value for g in Grade],
            "description": (
                "Грейд кандидата. Выводи по опыту/названию должности: Junior <2 лет, "
                "Middle 2-5 лет, Senior 5+ лет / 'Senior' в названии, Lead — Tech/Team Lead."
            ),
        },
        "experienceYears": {
            "type": "number",
            "description": (
                "Общий опыт в годах (число). Берётся из заголовка секции опыта: "
                "'Опыт работы — 13 лет 11 месяцев' → 13. Если только месяцы — округли до 1."
            ),
        },
        "format": {
            "type": "string",
            "enum": [f.value for f in WorkFormat],
            "description": (
                "Желаемый формат работы. 'Удалённо' для remote/удалёнки, "
                "'Гибрид' для hybrid, 'Офис' для on-site."
            ),
        },
        "rateMonth": {
            "type": "number",
            "description": (
                "Ожидаемая зарплата кандидата в рублях в месяц (число, без 'на руки'/'₽'). "
                "Если указано в долларах — НЕ заполняй (рекрутер сам пересчитает)."
            ),
        },
        "location": {
            "type": "string",
            "description": (
                "Город проживания. Берётся из 'Проживает: <город>' / 'Reside in: <city>'."
            ),
        },
        "birthday": {
            "type": "string",
            "description": (
                "Дата рождения в формате YYYY-MM-DD. Берётся из шапки резюме "
                "('родился 17 июля 1991', 'born on 24 March 1998')."
            ),
        },
        "telegram": {
            "type": "string",
            "description": "Telegram-контакт (@username или t.me/...), если есть.",
        },
        "phone": {
            "type": "string",
            "description": "Номер телефона как есть (с +7 / +XX, скобками, дефисами).",
        },
        "email": {"type": "string", "description": "Email-адрес кандидата."},
        "stack": {
            "type": "string",
            "description": (
                "Сводный CSV-список ключевых технологий через запятую с пробелом, "
                "например 'Java, Spring, Kafka, PostgreSQL'. Это плоский список "
                "для поиска и канбана — НЕ дублирует skillCategories, а агрегирует их. "
                "НЕ включай сюда естественные языки (Русский, Английский, Немецкий и т.п.) — "
                "они хранятся отдельно в `languages`."
            ),
        },
        "summary": {
            "type": "string",
            "description": (
                "ДОСЛОВНО текст из секции 'Обо мне' / 'About me' / "
                "'Дополнительная информация' — самопрезентация кандидата целиком, "
                "БЕЗ обрезки и БЕЗ пересказа своими словами. Сохраняй переносы строк, "
                "подзаголовки (Soft Skills:, Hard Skills:) и перечисления как есть. "
                "Если такой секции в резюме НЕТ — оставь поле пустым (не возвращай его). "
                "НИКОГДА не сочиняй сводку по опыту — это запрещено."
            ),
        },
        "skillCategories": {
            "type": "array",
            "items": _SKILL_CATEGORY_SCHEMA,
            "description": (
                "Категоризованные навыки из резюме. Если в резюме есть блоки "
                "('Языки программирования', 'Технологии', 'DevOps' и т.п.) — "
                "разложи по категориям; иначе верни одну категорию 'Ключевые навыки' "
                "со всеми тегами из секции 'Навыки'."
            ),
        },
        "experience": {
            "type": "array",
            "items": _EXPERIENCE_SCHEMA,
            "description": (
                "Места работы, от самого свежего к самому старому (как в HH). "
                "Каждое — отдельный объект."
            ),
        },
        "education": {
            "type": "array",
            "items": _EDUCATION_SCHEMA,
            "description": "Образование (вуз, ссуз, дополнительное высшее) — список.",
        },
        "certifications": {
            "type": "array",
            "items": _CERTIFICATION_SCHEMA,
            "description": (
                "Курсы и сертификаты. Брать из секции 'Повышение квалификации, "
                "курсы' / 'Сертификаты' / 'Дополнительная информация'."
            ),
        },
        "languages": {
            "type": "array",
            "items": _LANGUAGE_SCHEMA,
            "description": "Знание языков и уровень владения.",
        },
    },
    "additionalProperties": False,
}


_SYSTEM_PROMPT = """\
Ты — помощник CRM рекрутингового агентства. Твоя задача — разобрать сплошной \
текст резюме (как правило, выгруженный из PDF с hh.ru) и разложить его по \
структурированным полям карточки кандидата.

ГЛАВНОЕ ПРАВИЛО: твоя работа — структурировать, а НЕ пересказывать. Содержимое \
полей переноси из резюме ДОСЛОВНО. Менять формат можно (списки, даты), но смысл \
и текст пунктов оставляй как есть. Ничего не выдумывай и ничего не выкидывай. \
ИСКЛЮЧЕНИЕ — перевод (правило 2): если резюме на другом языке, «дословно» \
означает полный и точный перевод на русский без потери смысла и без сокращения \
пунктов (сколько буллетов в оригинале — столько и в переводе).

Правила:
1. Возвращай ТОЛЬКО ту информацию, которая явно есть в тексте. Если поле не \
упомянуто — НЕ включай его в ответ. НИЧЕГО НЕ ВЫДУМЫВАЙ.
2. ЯЗЫК ВЫВОДА — РУССКИЙ. Определи язык исходного резюме:
   • Если оно уже на русском — переноси текст как есть, ничего не переводя.
   • Если оно на английском (или любом другом языке) — ПЕРЕВЕДИ весь \
     повествовательный текст на естественный, грамотный русский: должности \
     (`role`, `experience[].position`), обязанности и достижения \
     (`experience[].achievements`), описание проекта (`experience[].project`), \
     блок «обо мне» (`summary`), названия категорий навыков \
     (`skillCategories[].name`), специальность и степень в образовании \
     (`education[].specialty`, `education[].degree`), названия сертификатов \
     (`certifications[].title`). Перевод должен быть точным и полным — не \
     сокращай и не обобщай (см. ГЛАВНОЕ ПРАВИЛО).
   • Имена собственные — названия компаний, вузов, продуктов — переведи или \
     транслитерируй на русский (например, 'Google' → 'Гугл', \
     'Massachusetts Institute of Technology' → 'Массачусетский технологический \
     институт'). Если есть устоявшийся русский вариант — используй его.
   • НЕ переводи и НЕ транслитерируй названия технологий, языков \
     программирования, фреймворков и инструментов в `stack` и \
     `skillCategories[].items` — оставляй их в каноничной форме латиницей \
     (PostgreSQL, Kubernetes, Java, React). Они нужны для поиска и матчинга.
   • ФИО кандидата: имя и фамилию транслитерируй на русский \
     (например, 'John Smith' → 'Джон Смит').
   • Названия естественных языков в `languages[].language` — на русском \
     ('English' → 'Английский').
3. Если текст вообще не похож на резюме — верни пустой объект.
4. Даты:
   • `birthday` — формат YYYY-MM-DD.
   • `experience[].startMonth` / `endMonth` — формат YYYY-MM (без числа).
   • Для текущей работы ('по настоящее время', 'till now', 'present') — \
     `endMonth` оставь пустой строкой.
5. ФИО кандидата в HH-резюме часто скрыто в шапке. Если в шапке нет — посмотри \
блок 'Комментарии к резюме' (там рекрутер обычно его прописывает).
6. `experienceYears` — единое число общего опыта из заголовка секции опыта \
('Опыт работы — 13 лет' → 13).
7. `stack` — это плоский CSV-список ключевых технологий для канбана; \
`skillCategories` — те же навыки, но сгруппированные по категориям. Они \
СОГЛАСОВАНЫ: всё, что в skillCategories, должно отражаться в stack. Если в \
резюме есть отдельный блок 'Hard Skills' / 'Hard skills' (например, через `/`) \
в секции 'Обо мне' — обязательно включи эти технологии в `stack` и \
`skillCategories` тоже.
8. Если в резюме нет явных категорий навыков — собери все теги в одну \
категорию 'Ключевые навыки'.
9. ВЛАДЕНИЕ ИНОСТРАННЫМИ/ЕСТЕСТВЕННЫМИ ЯЗЫКАМИ (Русский, Английский, \
Немецкий, Французский, Испанский, Китайский и т.д.) — это ОТДЕЛЬНОЕ поле \
`languages`. Никогда не клади их в `stack` и в `skillCategories[].items`. \
Технологии «языки программирования» (Python, Java, Go, ...) — это `stack`/`skillCategories`. \
Если сомневаешься: умеет говорить = languages; умеет программировать = stack. \
Также не клади в `stack` уровни (A1/B2/C1, Intermediate, Fluent) и слова \
«разговорный», «технический», «со словарём» — это атрибуты языка из `languages`.
10. `experience[].achievements` — это ВСЕ буллеты под должностью разом, и \
обязанности, и пункты блока 'Достижения:', и любые перечисления через '-', '•', '—'. \
НЕ выкидывай обычные обязанности только потому, что они не помечены как \
'достижение'. Сколько пунктов в исходнике на этом месте работы — столько же \
должно быть и в `achievements`. Каждый пункт переноси дословно.
11. `summary` — только для блока 'Обо мне' / 'About me' / 'Дополнительная \
информация'. Переноси его ДОСЛОВНО, со всеми подзаголовками (Soft Skills:, \
Hard Skills:) и перечислениями; если блок на другом языке — переведи его на \
русский целиком, сохранив все подзаголовки и пункты (правило 2). Если такого блока в резюме нет — НЕ заполняй \
`summary` (не возвращай его в ответе). Категорически запрещено писать в \
`summary` сводку по опыту, должности или стеку из своей головы — это худшее, \
что можно сделать с резюме.
12. Контакты: `phone`, `email`, `telegram` — заполняй все, что есть в шапке. \
Если в строке телефона написано 'WhatsApp, Telegram' — это не значит, что у \
кандидата есть telegram-ник; ник нужен явный (@username или t.me/...).

Сегодняшняя дата: {today}.
"""


# ─── Chunked-парсинг больших резюме ──────────────────────────────────────────
# Проблема: HH-резюме на 10+ страниц (десятки мест работы, сотни буллетов)
# физически не влезает в один вызов yandexgpt/rc: контекст модели 32к токенов,
# а промпт требует переносить каждый буллет ДОСЛОВНО, т.е. выход почти
# зеркалит вход. На 12-страничном резюме вход ~15-18к токенов + выход ~15к
# токенов → модель обрывает JSON по лимиту → AiTruncatedJsonError → 413.
#
# Решение: большие резюме режем на части и вызываем модель несколько раз
# ПАРАЛЛЕЛЬНО:
#   • «шапка + хвост» (всё, кроме тела секции «Опыт работы») → один вызов со
#     схемой без `experience` — контакты, грейд, навыки, образование, языки;
#   • тело «Опыта работы» режем по границам мест работы (строка вида
#     «Декабрь 2023 —») и группируем в чанки ≤ _EXP_CHUNK_MAX_CHARS → по
#     вызову на чанк со схемой из одного поля `experience`.
# Результаты склеиваем с сохранением порядка мест работы.
#
# Маленькие резюме (≤ _CHUNK_THRESHOLD_CHARS) идут по старому пути одним
# вызовом — это быстрее и дешевле.

_CHUNK_THRESHOLD_CHARS = 15_000
_EXP_CHUNK_MAX_CHARS = 9_000
# Выход чанка ~зеркалит вход (9к символов ≈ 3.5к токенов) + JSON-обвязка.
_EXP_CHUNK_MAX_TOKENS = 10_000
_HEADER_MAX_TOKENS = 6_000
# Таймаут одного вызова. Дефолтные 30с (yandex_ai_timeout_seconds) впритык
# даже для чанка: на больших ответах модель генерирует 20-30с.
_RESUME_CALL_TIMEOUT_SECONDS = 60.0

_MONTHS_RU = (
    "Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|"
    "Сентябрь|Октябрь|Ноябрь|Декабрь"
)
_MONTHS_EN = (
    "January|February|March|April|May|June|July|August|"
    "September|October|November|December"
)
# Начало места работы в HH-выгрузке: строка «<Месяц> <год> —…».
# Только горизонтальные пробелы ([ \t ]) — `\s` пересекал бы перенос
# строки и строка конца работы («Декабрь 2023») слипалась бы со следующей.
_EXP_ENTRY_RE = re.compile(
    rf"^(?:{_MONTHS_RU}|{_MONTHS_EN})[ \t ]+\d{{4}}[ \t ]*[—–-]",
    re.MULTILINE,
)
# Заголовок секции опыта: «Опыт работы — 24 года 7 месяцев».
_EXP_SECTION_RE = re.compile(
    r"^(?:Опыт работы|Work experience)\b[^\n]*$", re.MULTILINE
)
# Секции ПОСЛЕ опыта (границы хвоста). Матчим строку целиком, чтобы не
# спутать с индустрией места работы («Повышение квалификации, переквалификация»).
_TAIL_SECTION_RE = re.compile(
    r"^(?:Образование|Education|Навыки|Skills|Ключевые навыки|Key skills|"
    r"Повышение квалификации, курсы|Знание языков|Languages|"
    r"Тесты, экзамены|Электронные сертификаты|"
    r"Дополнительная информация|Additional information|Обо мне|About me|"
    r"Комментарии к резюме|Resume comments)\s*$",
    re.MULTILINE,
)

_EXPERIENCE_ONLY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"experience": PARSED_CANDIDATE_SCHEMA["properties"]["experience"]},
    "additionalProperties": False,
}

_HEADER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        k: v for k, v in PARSED_CANDIDATE_SCHEMA["properties"].items() if k != "experience"
    },
    "additionalProperties": False,
}

_EXPERIENCE_SYSTEM_PROMPT = """\
Ты — помощник CRM рекрутингового агентства. Тебе дан ФРАГМЕНТ резюме — одно \
или несколько мест работы (выгрузка из PDF с hh.ru). Разложи КАЖДОЕ место \
работы в массив `experience`, сохраняя порядок из текста.

ГЛАВНОЕ ПРАВИЛО: структурировать, а НЕ пересказывать. Текст пунктов переноси \
ДОСЛОВНО. Ничего не выдумывай и ничего не выкидывай.

Правила:
1. `achievements` — это ВСЕ буллеты под должностью разом: и обязанности, и \
пункты блока 'Достижения:', и любые перечисления через '-', '•', '—'. Сколько \
пунктов в исходнике — столько же в `achievements`. Каждый пункт дословно, без \
префиксов '-', '•'.
2. ЯЗЫК ВЫВОДА — РУССКИЙ. Если фрагмент на другом языке — переведи \
должности, обязанности и описания проектов на грамотный русский полностью, \
без сокращения пунктов. Названия технологий в `stack` оставляй латиницей \
(PostgreSQL, Kubernetes, Java). Названия компаний переведи или \
транслитерируй, если есть устоявшийся русский вариант.
3. Даты: `startMonth`/`endMonth` — формат YYYY-MM. Для текущей работы \
('по настоящее время', 'till now', 'present') `endMonth` — пустая строка.
4. `stack` места работы — из явного блока 'Технологии:'/'Стек:'; если его \
нет — пусто.
5. Если во фрагменте нет мест работы — верни пустой массив.

Сегодняшняя дата: {today}.
"""


def _split_hh_resume(text: str) -> tuple[str, list[str], str] | None:
    """Разрезать HH-выгрузку на (шапка, места работы, хвост).

    Шапка включает заголовок секции опыта («Опыт работы — 24 года…») — из
    него модель берёт `experienceYears`. Возвращает None, если структура не
    распознана — вызывающий код падает обратно на одиночный вызов.
    """
    section_m = _EXP_SECTION_RE.search(text)
    if not section_m:
        return None
    exp_start = section_m.end()

    tail_m = _TAIL_SECTION_RE.search(text, exp_start)
    exp_end = tail_m.start() if tail_m else len(text)

    head = text[:exp_start]
    exp_block = text[exp_start:exp_end]
    tail = text[exp_end:]

    starts = [m.start() for m in _EXP_ENTRY_RE.finditer(exp_block)]
    if not starts:
        return None
    entries: list[str] = []
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(exp_block)
        entry = exp_block[s:e].strip()
        if entry:
            entries.append(entry)
    if not entries:
        return None
    return head, entries, tail


def _pack_entries(entries: list[str], max_chars: int) -> list[str]:
    """Сгруппировать места работы в чанки ≤ max_chars (жадно, порядок сохраняем)."""
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for entry in entries:
        entry_len = len(entry) + 2
        if current and current_len + entry_len > max_chars:
            chunks.append("\n\n".join(current))
            current = []
            current_len = 0
        current.append(entry)
        current_len += entry_len
    if current:
        chunks.append("\n\n".join(current))
    return chunks


async def _parse_resume_chunked(
    client: YandexGptClient,
    head: str,
    entries: list[str],
    tail: str,
    *,
    today: str,
    max_chars: int,
) -> dict[str, Any]:
    """Chunked-путь: шапка+хвост и чанки опыта — параллельными вызовами."""
    header_input = f"{head}\n{tail}".strip()[:max_chars]
    exp_chunks = _pack_entries(entries, _EXP_CHUNK_MAX_CHARS)

    header_task = client.json_completion(
        system=_SYSTEM_PROMPT.format(today=today),
        user=header_input,
        schema_name="parsed_candidate_header",
        schema=_HEADER_SCHEMA,
        max_tokens=_HEADER_MAX_TOKENS,
    )
    exp_tasks = [
        client.json_completion(
            system=_EXPERIENCE_SYSTEM_PROMPT.format(today=today),
            user=chunk[:max_chars],
            schema_name="parsed_candidate_experience",
            schema=_EXPERIENCE_ONLY_SCHEMA,
            max_tokens=_EXP_CHUNK_MAX_TOKENS,
        )
        for chunk in exp_chunks
    ]

    header_raw, *exp_raws = await asyncio.gather(header_task, *exp_tasks)

    merged: dict[str, Any] = dict(header_raw)
    merged.pop("experience", None)  # схема не должна была его вернуть, но перестрахуемся
    experience: list[Any] = []
    for raw in exp_raws:
        items = raw.get("experience")
        if isinstance(items, list):
            experience.extend(items)
    if experience:
        merged["experience"] = experience

    logger.info(
        "candidates.ai chunked parse: %d experience chunks, %d entries, %d merged jobs",
        len(exp_chunks),
        len(entries),
        len(experience),
    )
    return merged


# ─── Нормализация ответа ────────────────────────────────────────────────────


def _clean_string(value: Any) -> str | None:
    """Привести значение к непустой строке или вернуть None."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v or v.lower() in {"null", "none", "n/a", "не указано", "не указан"}:
        return None
    return v


def _coerce_enum(value: Any, allowed: set[str]) -> str | None:
    """Вернуть значение, если оно в списке допустимых (case-insensitive), иначе None."""
    s = _clean_string(value)
    if s is None:
        return None
    if s in allowed:
        return s
    s_lower = s.lower()
    for v in allowed:
        if v.lower() == s_lower:
            return v
    return None


def _coerce_positive_number(value: Any) -> float | None:
    """Извлечь положительное число из числа/строки. None — если невалидно."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return num if num > 0 else None
    if isinstance(value, str):
        # Берём первое число в строке.
        m = re.search(r"\d+(?:[.,]\d+)?", value.replace(" ", "").replace(" ", ""))
        if not m:
            return None
        try:
            num = float(m.group(0).replace(",", "."))
        except ValueError:
            return None
        return num if num > 0 else None
    return None


def _coerce_non_negative_number(value: Any) -> float | None:
    """Как `_coerce_positive_number`, но допускает 0 (для experienceYears)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return num if num >= 0 else None
    if isinstance(value, str):
        m = re.search(r"\d+(?:[.,]\d+)?", value.replace(" ", "").replace(" ", ""))
        if not m:
            return None
        try:
            num = float(m.group(0).replace(",", "."))
        except ValueError:
            return None
        return num if num >= 0 else None
    return None


def _coerce_iso_date(value: Any) -> str | None:
    """Извлечь YYYY-MM-DD из произвольной строки. None — если невалидно."""
    s = _clean_string(value)
    if not s:
        return None
    m = _ISO_DATE_RE.search(s)
    if m:
        y, mo, d = m.group(1), m.group(2), m.group(3)
    else:
        m2 = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
        if not m2:
            return None
        y, mo, d = m2.group(1), m2.group(2).zfill(2), m2.group(3).zfill(2)
    try:
        date(int(y), int(mo), int(d))
    except ValueError:
        return None
    return f"{y}-{mo}-{d}"


def _coerce_iso_month(value: Any) -> str:
    """Извлечь YYYY-MM. Пустая строка — если невалидно (для endMonth='настоящее время')."""
    s = _clean_string(value)
    if not s:
        return ""
    m = _ISO_MONTH_RE.search(s)
    if not m:
        # Иногда модель пишет YYYY-MM-DD в startMonth — берём YYYY-MM.
        m2 = _ISO_DATE_RE.search(s)
        if not m2:
            return ""
        y, mo = m2.group(1), m2.group(2)
    else:
        y, mo = m.group(1), m.group(2).zfill(2)
    try:
        month_i = int(mo)
        if not 1 <= month_i <= 12:
            return ""
    except ValueError:
        return ""
    return f"{y}-{mo}"


def _coerce_str_list(value: Any) -> list[str]:
    """Привести список строк, отфильтровав пустые/мусорные значения."""
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        s = _clean_string(item)
        if s:
            out.append(s)
    return out


def _coerce_skill_categories(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _clean_string(item.get("name"))
        items = _coerce_str_list(item.get("items"))
        if not name or not items:
            continue
        out.append({"name": name, "items": items})
    return out


def _coerce_experience(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        company = _clean_string(item.get("company")) or ""
        position = _clean_string(item.get("position")) or ""
        if not company and not position:
            continue
        out.append(
            {
                "company": company,
                "position": position,
                "startMonth": _coerce_iso_month(item.get("startMonth")),
                "endMonth": _coerce_iso_month(item.get("endMonth")),
                "project": _clean_string(item.get("project")) or "",
                "achievements": _coerce_str_list(item.get("achievements")),
                "stack": _coerce_str_list(item.get("stack")),
            }
        )
    return out


def _coerce_education(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        institution = _clean_string(item.get("institution"))
        if not institution:
            continue
        year_raw = item.get("graduationYear")
        year_int: int | None = None
        if isinstance(year_raw, bool):
            year_int = None
        elif isinstance(year_raw, (int, float)):
            year_int = int(year_raw)
        elif isinstance(year_raw, str):
            m = re.search(r"(19|20)\d{2}", year_raw)
            if m:
                try:
                    year_int = int(m.group(0))
                except ValueError:
                    year_int = None
        if year_int is None or not 1950 <= year_int <= 2100:
            continue
        out.append(
            {
                "degree": _clean_string(item.get("degree")) or "Высшее",
                "institution": institution,
                "city": _clean_string(item.get("city")) or "",
                "graduationYear": year_int,
                "specialty": _clean_string(item.get("specialty")) or "",
            }
        )
    return out


def _coerce_certifications(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = _clean_string(item.get("title"))
        issuer = _clean_string(item.get("issuer"))
        if not title or not issuer:
            continue
        out.append(
            {
                "title": title,
                "issuer": issuer,
                "period": _clean_string(item.get("period")) or "",
            }
        )
    return out


def _coerce_languages(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        language = _clean_string(item.get("language"))
        if not language:
            continue
        level = _coerce_enum(item.get("level"), _LANGUAGE_LEVELS_SET)
        if not level:
            continue
        out.append({"language": language, "level": level})
    return out


# ─── Защита от попадания естественных языков в стек технологий ──────────────
# Несмотря на явное правило в промпте, модель иногда всё равно тащит
# «Английский», «B2», «Разговорный» в `stack` / `skillCategories[].items`.
# Поэтому делаем пост-фильтр: drop в стеке любых токенов, похожих на
# естественный язык или уровень владения им.

# Распространённые названия (русский и английский варианты, нижний регистр).
_NATURAL_LANGUAGES: frozenset[str] = frozenset(
    {
        # русский
        "русский", "английский", "немецкий", "французский", "испанский",
        "итальянский", "португальский", "китайский", "японский", "корейский",
        "арабский", "турецкий", "польский", "украинский", "белорусский",
        "армянский", "грузинский", "узбекский", "казахский", "татарский",
        "иврит", "финский", "шведский", "норвежский", "датский", "голландский",
        "нидерландский", "греческий", "чешский", "словацкий", "венгерский",
        "румынский", "болгарский", "сербский", "хорватский", "вьетнамский",
        "тайский", "хинди", "урду", "фарси", "персидский",
        # english
        "russian", "english", "german", "french", "spanish", "italian",
        "portuguese", "chinese", "mandarin", "cantonese", "japanese", "korean",
        "arabic", "turkish", "polish", "ukrainian", "belarusian", "armenian",
        "georgian", "uzbek", "kazakh", "tatar", "hebrew", "finnish", "swedish",
        "norwegian", "danish", "dutch", "greek", "czech", "slovak", "hungarian",
        "romanian", "bulgarian", "serbian", "croatian", "vietnamese", "thai",
        "hindi", "urdu", "persian", "farsi",
    }
)

# Уровни и слова-маркеры владения. Совпадают целиком (case-insensitive).
_LANGUAGE_LEVEL_TOKENS: frozenset[str] = frozenset(
    {
        # CEFR
        "a1", "a2", "b1", "b2", "c1", "c2",
        # русские словесные уровни
        "родной", "свободный", "свободно", "в совершенстве",
        "разговорный", "технический", "со словарём", "со словарем",
        "начальный", "элементарный", "средний", "средне-продвинутый",
        "продвинутый", "базовый", "базовое владение", "чтение и перевод",
        # английские словесные уровни
        "native", "fluent", "advanced", "upper-intermediate", "upper intermediate",
        "intermediate", "pre-intermediate", "pre intermediate", "elementary",
        "beginner", "basic", "proficient", "proficiency", "conversational",
    }
)


def _is_language_token(token: str, languages: set[str]) -> bool:
    """Похоже ли значение на естественный язык / уровень владения им."""
    t = token.strip().lower()
    if not t:
        return False
    if t in _NATURAL_LANGUAGES or t in _LANGUAGE_LEVEL_TOKENS:
        return True
    if t in languages:
        return True
    # «Английский — B2», «Русский B2», «English: C1» одним токеном —
    # отрежем по разделителю (тире/двоеточие/пробел) и проверим первое слово.
    head = re.split(r"[\s—–\-:]+", t, maxsplit=1)[0].strip()
    if head and (head in _NATURAL_LANGUAGES or head in languages):
        return True
    return False


def _filter_language_tokens(out: dict[str, Any]) -> None:
    """Мутирует `out`: убирает естественные языки/уровни из stack и skillCategories.

    Питон-side стена против ситуации, когда модель проигнорировала правило
    промпта и положила 'Английский B2' в плоский стек. Это бьёт по UX:
    в канбане в чипах появлялся «Английский», что путало рекрутеров.
    """
    # Множество названий уже распознанных естественных языков.
    spoken: set[str] = set()
    for lang in out.get("languages", []) or []:
        if isinstance(lang, dict):
            name = _clean_string(lang.get("language"))
            if name:
                spoken.add(name.lower())

    # 1) `stack` — CSV-строка, разрезаем, фильтруем, склеиваем обратно.
    stack_raw = out.get("stack")
    if isinstance(stack_raw, str) and stack_raw:
        parts = [p.strip() for p in stack_raw.split(",")]
        kept = [p for p in parts if p and not _is_language_token(p, spoken)]
        if kept:
            out["stack"] = ", ".join(kept)
        else:
            out.pop("stack", None)

    # 2) `skillCategories[].items` — фильтруем; пустые категории — выкидываем;
    #    категория с «языковым» именем тоже отбрасывается целиком.
    cats = out.get("skillCategories")
    if isinstance(cats, list):
        cleaned_cats: list[dict[str, Any]] = []
        for cat in cats:
            if not isinstance(cat, dict):
                continue
            name = cat.get("name") or ""
            if isinstance(name, str) and _is_language_token(name, spoken):
                continue  # категория «Иностранные языки» / «Знание языков» — целиком в /dev/null
            items = cat.get("items")
            if not isinstance(items, list):
                continue
            kept_items = [
                it for it in items
                if isinstance(it, str) and not _is_language_token(it, spoken)
            ]
            if kept_items:
                cleaned_cats.append({"name": name, "items": kept_items})
        if cleaned_cats:
            out["skillCategories"] = cleaned_cats
        else:
            out.pop("skillCategories", None)

    # 3) experience[].stack — тот же фильтр.
    exp = out.get("experience")
    if isinstance(exp, list):
        for e in exp:
            if not isinstance(e, dict):
                continue
            es = e.get("stack")
            if isinstance(es, list):
                e["stack"] = [
                    s for s in es
                    if isinstance(s, str) and not _is_language_token(s, spoken)
                ]


def _coerce_parsed(raw: dict[str, Any]) -> dict[str, Any]:
    """Нормализация ответа LLM в финальный ParsedCandidate-friendly dict.

    Каждое поле валидируем отдельно. Если значение не пригодно — ТИХО отбрасываем
    (с записью в лог на уровне debug). Лучше отдать частичный результат, чем 500.
    """
    out: dict[str, Any] = {}

    for key in ("fullName", "role", "location", "telegram", "phone", "email", "stack", "summary"):
        s = _clean_string(raw.get(key))
        if s:
            out[key] = s

    grade = _coerce_enum(raw.get("grade"), _GRADE_VALUES)
    if grade:
        out["grade"] = grade

    fmt = _coerce_enum(raw.get("format"), _FORMAT_VALUES)
    if fmt:
        out["format"] = fmt

    rate = _coerce_positive_number(raw.get("rateMonth"))
    if rate is not None:
        out["rateMonth"] = rate

    exp_years = _coerce_non_negative_number(raw.get("experienceYears"))
    if exp_years is not None:
        out["experienceYears"] = exp_years

    birthday = _coerce_iso_date(raw.get("birthday"))
    if birthday:
        out["birthday"] = birthday
    elif raw.get("birthday"):
        logger.debug("candidates.ai dropped invalid birthday: %r", raw.get("birthday"))

    sc = _coerce_skill_categories(raw.get("skillCategories"))
    if sc:
        out["skillCategories"] = sc

    exp = _coerce_experience(raw.get("experience"))
    if exp:
        out["experience"] = exp

    edu = _coerce_education(raw.get("education"))
    if edu:
        out["education"] = edu

    certs = _coerce_certifications(raw.get("certifications"))
    if certs:
        out["certifications"] = certs

    langs = _coerce_languages(raw.get("languages"))
    if langs:
        out["languages"] = langs

    # Защитный фильтр: выкидываем естественные языки/уровни из stack и
    # skillCategories, если модель проигнорировала правило промпта.
    _filter_language_tokens(out)

    return out


async def parse_resume_text(text: str, *, today: str) -> dict[str, Any]:
    """Распарсить сплошной текст резюме.

    Маленькие резюме (≤ _CHUNK_THRESHOLD_CHARS) — одним вызовом модели, как
    раньше. Большие — chunked-путём (см. блок «Chunked-парсинг» выше): раньше
    они гарантированно упирались в 32к-контекст yandexgpt/rc и падали с 413
    resume_too_long, потому что «дословный» JSON-выход почти зеркалит вход.

    Возвращает dict с camelCase-ключами, готовый к сериализации в ParsedCandidate.
    Бросает `AiUnavailableError` / `AiBadRequestError` — обрабатывается в эндпоинте.
    """
    settings = get_settings()
    max_chars = settings.yandex_ai_max_input_chars

    client = YandexGptClient(timeout_seconds=_RESUME_CALL_TIMEOUT_SECONDS)

    if len(text) > _CHUNK_THRESHOLD_CHARS:
        split = _split_hh_resume(text)
        if split is not None:
            head, entries, tail = split
            raw = await _parse_resume_chunked(
                client, head, entries, tail, today=today, max_chars=max_chars
            )
            return _coerce_parsed(raw)
        # Структура не распозналась (не HH-выгрузка?) — best effort одним
        # вызовом с обрезкой входа, как раньше.
        logger.warning(
            "candidates.ai big resume (%d chars) but HH structure not detected, "
            "falling back to single call",
            len(text),
        )

    snippet = text if len(text) <= max_chars else text[:max_chars]
    raw = await client.json_completion(
        system=_SYSTEM_PROMPT.format(today=today),
        user=snippet,
        schema_name="parsed_candidate",
        schema=PARSED_CANDIDATE_SCHEMA,
        # Резюме большие (HH-PDF на 6-8 страниц с десятками буллетов в опыте
        # разворачивается в JSON на 5-8к токенов). Прежний лимит 4096 регулярно
        # обрезал ответ на середине, json.loads падал → 503 ai_unavailable.
        # yandexgpt/rc держит общий контекст 32к токенов, запас остаётся.
        max_tokens=12000,
    )
    return _coerce_parsed(raw)


__all__ = [
    "PARSED_CANDIDATE_SCHEMA",
    "AiBadRequestError",
    "AiTruncatedJsonError",
    "AiUnavailableError",
    "parse_resume_text",
]
