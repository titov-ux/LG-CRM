"""Утилита для отладки AI-распознавания брифа вакансии.

Запуск в контейнере:
    docker exec -i crm-lg-backend python -m scripts.ai_smoke < brief.txt

или интерактивно:
    docker exec -it crm-lg-backend python -m scripts.ai_smoke
    (введите текст, в конце Ctrl-D)

или одной строкой:
    echo "Ищем Senior Python на 6 месяцев" | docker exec -i crm-lg-backend python -m scripts.ai_smoke

Печатает три блока:
  1) Сырой ответ YandexGPT (как пришёл из API).
  2) Coerced — после `_coerce_parsed` (с отбрасыванием битых полей).
  3) Pydantic-валидация — что увидит фронт.

Удобно для отладки прод-кейсов: видно где конкретно теряется поле.
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import date

from app.modules.vacancies.ai import (
    PARSED_VACANCY_SCHEMA,
    _SYSTEM_PROMPT,
    _coerce_parsed,
)
from app.integrations.yandex_gpt import (
    AiBadRequestError,
    AiUnavailableError,
    YandexGptClient,
)
from app.modules.vacancies.schemas import ParsedVacancy


def _print_section(title: str, body: object) -> None:
    print(f"\n{'═' * 70}")
    print(f" {title}")
    print("═" * 70)
    if isinstance(body, (dict, list)):
        print(json.dumps(body, ensure_ascii=False, indent=2, default=str))
    else:
        print(body)


async def main() -> int:
    text = sys.stdin.read().strip()
    if not text:
        print("ERROR: на stdin пусто. Передай текст брифа.", file=sys.stderr)
        return 2

    _print_section("📥 Текст брифа на входе", text)

    client = YandexGptClient()
    if not client.is_configured:
        print(
            "ERROR: YandexGptClient не сконфигурирован "
            "(нет YANDEX_API_KEY и/или YANDEX_FOLDER_ID в env контейнера).",
            file=sys.stderr,
        )
        return 3

    print(
        f"\n→ Yandex AI Studio: model={client.model}, folder={client.folder_id[:8]}…",
        file=sys.stderr,
    )

    try:
        raw = await client.json_completion(
            system=_SYSTEM_PROMPT.format(today=date.today().isoformat()),
            user=text,
            schema_name="parsed_vacancy",
            schema=PARSED_VACANCY_SCHEMA,
        )
    except AiBadRequestError as exc:
        print(f"\n❌ AiBadRequestError (4xx от Яндекса): {exc}", file=sys.stderr)
        return 4
    except AiUnavailableError as exc:
        print(f"\n❌ AiUnavailableError (сеть/5xx/нет ключа): {exc}", file=sys.stderr)
        return 5

    _print_section("1️⃣  Сырой ответ YandexGPT (что вернула модель)", raw)

    coerced = _coerce_parsed(raw)
    _print_section("2️⃣  После _coerce_parsed (отброшены битые значения)", coerced)

    # Сравнение: что отбросили?
    dropped: dict[str, object] = {}
    for k, v in raw.items():
        if k not in coerced or coerced.get(k) != v:
            dropped[k] = {"raw": v, "coerced": coerced.get(k, "<dropped>")}
    if dropped:
        _print_section("ℹ️  Поля, которые были изменены/отброшены при нормализации", dropped)

    try:
        pv = ParsedVacancy.model_validate(coerced)
    except Exception as exc:
        _print_section("❌ Pydantic ValidationError (это будет 500 у пользователя)", str(exc))
        return 6

    final = pv.model_dump(by_alias=True, exclude_none=True, mode="json")
    _print_section("3️⃣  Финальный ответ (что увидит фронт)", final)

    print(
        f"\n✅ OK — распознано {len(final)} из {len(PARSED_VACANCY_SCHEMA['properties'])} полей.\n",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
