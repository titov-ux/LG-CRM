/**
 * Возвращает ссылку, только если это http(s). Всё остальное (`javascript:`,
 * `data:` и т.п.) отбрасывается — такие ссылки нельзя класть в href или
 * window.open: React 18 их не блокирует, и клик выполняет скрипт.
 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : undefined;
}

export const HTTP_URL_RE = /^https?:\/\/\S+$/i;
