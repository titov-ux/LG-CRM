import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { HTTPError } from 'ky';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Достаёт человекочитаемое сообщение из ApiError-ответа бэкенда ({ detail: { code, message } }). */
export async function apiErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (error instanceof HTTPError) {
    try {
      const body = (await error.response.json()) as
        | { detail?: { code?: string; message?: string } }
        | undefined;
      if (body?.detail?.message) return body.detail.message;
    } catch {
      /* тело не JSON — отдаём fallback */
    }
  }
  return fallback;
}

export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function formatMoneyRub(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

export function telegramUrl(telegram: string): string {
  const t = telegram.trim();
  if (/^https?:\/\//i.test(t)) return t;
  const handle = t.replace(/^@/, '');
  return `https://t.me/${handle}`;
}

export function formatDateRu(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
