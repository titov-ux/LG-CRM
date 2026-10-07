"""Рендер кадровых документов: HTML-шаблоны → PDF, лист подписания.

Шаблоны — HTML в `templates/` (Jinja2). Юридические тексты пока «рыбы» с
пометкой `ЧЕРНОВИК — ТЕКСТ НА СОГЛАСОВАНИИ У ЮРИСТА`: финальные тексты
подменяются заменой файлов без изменения кода.

Типографика — как у офферов (frontend/src/features/offers/generateOfferPdf.ts):
Golos Text, `@page` A4, правило `normalizeText` — без длинных тире и «ё».

PDF печатает Playwright (`files/pdf_service.py`). В тестах рендерер
подменяется через `set_pdf_renderer_for_tests` — Chromium там не нужен.
"""
from __future__ import annotations

import io
import re
from collections.abc import Awaitable, Callable
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from pypdf import PdfReader, PdfWriter

from app.core.config import get_settings

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
MSK = ZoneInfo("Europe/Moscow")
DRAFT_MARK = "ЧЕРНОВИК — ТЕКСТ НА СОГЛАСОВАНИИ У ЮРИСТА"

_MONTHS = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)


def normalize_text(value: Any) -> str:
    """Правило шаблонов LG: без длинных тире и буквы «ё»."""
    text = "" if value is None else str(value)
    text = re.sub(r"\s*[—–]\s*", " - ", text)
    return text.replace("ё", "е").replace("Ё", "Е")


def _parse_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.astimezone(MSK).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def date_ru(value: Any, placeholder: str = "«__» ________ 20__ г.") -> str:
    d = _parse_date(value)
    if d is None:
        return placeholder
    return f"«{d.day:02d}» {_MONTHS[d.month - 1]} {d.year} г."


def date_short(value: Any) -> str:
    d = _parse_date(value)
    return d.strftime("%d.%m.%Y") if d else "__.__.____"


def datetime_msk(value: datetime | None) -> str:
    if value is None:
        return "-"
    return value.astimezone(MSK).strftime("%d.%m.%Y %H:%M:%S МСК")


def money(value: Any) -> str:
    if value is None or value == "":
        return "________"
    try:
        amount = Decimal(str(value).replace(" ", "").replace(" ", "").replace(",", "."))
    except InvalidOperation:
        return normalize_text(value)
    whole = f"{int(amount):,}".replace(",", " ")
    return whole


def lines(value: Any) -> list[str]:
    return [ln.strip() for ln in str(value or "").splitlines() if ln.strip()]


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["t"] = normalize_text
    env.filters["date_ru"] = date_ru
    env.filters["date_short"] = date_short
    env.filters["dt_msk"] = datetime_msk
    env.filters["money"] = money
    env.filters["lines"] = lines
    return env


_ENV = _env()


def company_context() -> dict[str, Any]:
    s = get_settings()
    return {
        "name": s.hr_edo_company_name,
        "short": s.hr_edo_company_short,
        "inn": s.hr_edo_company_inn,
        "ogrn": s.hr_edo_company_ogrn,
        "address": s.hr_edo_company_address,
        "director_name": s.hr_edo_director_name,
        "director_position": s.hr_edo_director_position,
        "city": s.hr_edo_city,
    }


def render_document_html(
    template: str,
    *,
    title: str,
    number: str | None,
    doc_date: date,
    employee: dict[str, Any],
    fields: dict[str, Any],
    draft: bool,
    extra: dict[str, Any] | None = None,
) -> str:
    """HTML документа. `draft=True` — предпросмотр (номер ещё не присвоен)."""
    tpl = _ENV.get_template(template)
    return tpl.render(
        title=title,
        number=number,
        doc_date=doc_date,
        employee=employee,
        f=_FieldProxy(fields),
        company=company_context(),
        draft=draft,
        draft_mark=DRAFT_MARK,
        **(extra or {}),
    )


class _FieldProxy:
    """`f.salary` в шаблоне: пустое поле → пустая строка, а не ошибка рендера.

    Черновик можно смотреть с незаполненными полями; обязательность полей
    проверяется при заморозке (documents.freeze_document).
    """

    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    def __getattr__(self, name: str) -> Any:
        value = self._data.get(name)
        return "" if value is None else value

    def __getitem__(self, name: str) -> Any:
        return self.__getattr__(name)


def render_signing_sheet_html(context: dict[str, Any]) -> str:
    return _ENV.get_template("_signing_sheet.html").render(
        company=company_context(), draft_mark=DRAFT_MARK, **context
    )


# ── PDF ────────────────────────────────────────────────────────────────────

PdfRenderer = Callable[[str], Awaitable[bytes]]


async def _default_renderer(html: str) -> bytes:
    from app.modules.files.pdf_service import render_pdf_from_html

    return await render_pdf_from_html(html)


_renderer: PdfRenderer | None = None


def set_pdf_renderer_for_tests(renderer: PdfRenderer | None) -> None:
    global _renderer
    _renderer = renderer


async def html_to_pdf(html: str) -> bytes:
    return await (_renderer or _default_renderer)(html)


def append_pdf(original: bytes, appendix: bytes) -> bytes:
    """Склеить исходный PDF и лист подписания. Исходник не модифицируется —
    это новый файл (`stamped_file_id`)."""
    writer = PdfWriter()
    for src in (original, appendix):
        reader = PdfReader(io.BytesIO(src))
        for page in reader.pages:
            writer.add_page(page)
    writer.add_metadata({"/Producer": "CRM LG Integration - HR EDO"})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
