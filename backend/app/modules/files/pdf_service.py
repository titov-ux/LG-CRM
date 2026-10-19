"""Серверный рендер HTML → PDF (Playwright/Chromium).

HTML приходит от пользователя (`POST /files/render-pdf`), поэтому Chromium
изолирован от сети: без этого `<iframe src="http://crypto-service:…">` или
`http://169.254.169.254/…` позволял читать внутренние сервисы и метаданные
облака прямо в PDF (SSRF).

Ограничения:
  • JavaScript выключен — шаблоны резюме, оффера и HR-ЭДО его не используют;
  • наружу пускаем только `data:`/`about:`/`blob:` и Google Fonts (шрифты
    шаблонов), всё остальное — abort, включая навигации и iframe;
  • не больше `_MAX_CONCURRENT` Chromium одновременно и таймаут на рендер,
    чтобы эндпоинт нельзя было использовать для DoS.
"""
from __future__ import annotations

import asyncio
from urllib.parse import urlsplit

from playwright.async_api import Route, async_playwright

_MAX_CONCURRENT = 2
_RENDER_TIMEOUT_MS = 30_000
_ALLOWED_SCHEMES = {"data", "about", "blob"}
_ALLOWED_HTTPS_HOSTS = {"fonts.googleapis.com", "fonts.gstatic.com"}

_semaphore = asyncio.Semaphore(_MAX_CONCURRENT)


def is_allowed_url(url: str) -> bool:
    """Можно ли Chromium загружать этот ресурс при рендере PDF."""
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme in _ALLOWED_SCHEMES:
        return True
    return scheme == "https" and (parts.hostname or "").lower() in _ALLOWED_HTTPS_HOSTS


async def _guard(route: Route) -> None:
    if is_allowed_url(route.request.url):
        await route.continue_()
    else:
        await route.abort("blockedbyclient")


async def render_pdf_from_html(html: str) -> bytes:
    async with _semaphore, async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            context = await browser.new_context(
                java_script_enabled=False,
                service_workers="block",
            )
            # route на контексте ловит запросы всех фреймов страницы.
            await context.route("**/*", _guard)
            page = await context.new_page()
            page.set_default_timeout(_RENDER_TIMEOUT_MS)
            await page.set_content(html, wait_until="networkidle")
            return await page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                prefer_css_page_size=True,
            )
        finally:
            await browser.close()
