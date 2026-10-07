// Подписи и цвета статусов кадрового ЭДО + мелкие утилиты раздела.

import { HTTPError } from 'ky';
import type { HrDocStatus, HrEdoStatus, HrSigType } from '@/api/hrEdo';

export const EDO_STATUS: Record<HrEdoStatus, { label: string; className: string; hint: string }> = {
  not_invited: {
    label: 'Не приглашён',
    className: 'bg-muted text-muted-foreground',
    hint: 'Пакет согласия ещё не сформирован',
  },
  notified: {
    label: 'Ждём согласие',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    hint: 'Пакет согласия отправлен — ждём подписанный экземпляр',
  },
  consent_signed: {
    label: 'Согласие получено',
    className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
    hint: 'Сотрудник может получить электронную подпись по SMS',
  },
  active: {
    label: 'Подпись выдана',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    hint: 'Подписывает документы кодом из SMS',
  },
  refused: {
    label: 'Бумажный контур',
    className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
    hint: 'Отказ от КЭДО — документы на бумаге',
  },
  key_revoked: {
    label: 'Ключ отозван',
    className: 'bg-red-500/10 text-red-600 dark:text-red-400',
    hint: 'Нужно выпустить новую подпись',
  },
};

export const DOC_STATUS: Record<HrDocStatus, { label: string; className: string }> = {
  draft: { label: 'Черновик', className: 'bg-muted text-muted-foreground' },
  frozen: { label: 'Готов к отправке', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  awaiting_employer: {
    label: 'Ждёт подписи директора',
    className: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  },
  sent: { label: 'Отправлен', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  viewed: { label: 'Просмотрен', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  signed: { label: 'Подписан', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  rejected: { label: 'Отказ', className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  expired: { label: 'Просрочен', className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  cancelled: { label: 'Отменён', className: 'bg-muted text-muted-foreground line-through' },
  archived_paper: { label: 'Бумажный (архив)', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
};

export const SIG_TYPE_LABEL: Record<HrSigType, string> = {
  unep_lg: 'УНЭП ЛГ Интеграция (код из SMS)',
  gosklyuch: 'Госключ',
  ukep: 'УКЭП',
  paper: 'Бумага (скан оригинала)',
};

export const EVENT_LABEL: Record<string, string> = {
  created: 'Создан',
  frozen: 'Сформирован и заморожен',
  employer_signed: 'Подписан работодателем',
  sent: 'Отправлен сотруднику',
  notified: 'Уведомление',
  link_opened: 'Открыта ссылка',
  portal_login: 'Вход на портал',
  viewed: 'Просмотрен',
  viewed_to_end: 'Прочитан до конца',
  otp_sent: 'Отправлен SMS-код',
  otp_delivered: 'SMS доставлено',
  otp_failed: 'SMS не доставлено',
  signed: 'Подписан сотрудником',
  rejected: 'Отказ от подписи',
  downloaded: 'Скачан',
  exported: 'Выгружена подпись',
  consent_registered: 'Согласие зарегистрировано',
  key_issued: 'Выпущена подпись',
  key_revoked: 'Ключ отозван',
  phone_changed: 'Сменён телефон',
  cancelled: 'Отменён',
  employee_created: 'Сотрудник заведён',
  edo_refused: 'Отказ от КЭДО',
  expired: 'Истёк срок подписи',
  paper_signed: 'Подписан на бумаге',
};

/** Человекочитаемое сообщение из ApiError (`{detail: {code, message}}`). */
export async function apiErrorMessage(e: unknown, fallback = 'Что-то пошло не так'): Promise<string> {
  if (e instanceof HTTPError) {
    try {
      const body = (await e.response.clone().json()) as {
        detail?: { message?: string } | string;
        message?: string;
      };
      if (typeof body.detail === 'object' && body.detail?.message) return body.detail.message;
      if (typeof body.detail === 'string') return body.detail;
      if (body.message) return body.message;
    } catch {
      /* не JSON */
    }
    if (e.response.status === 503) return 'Кадровый ЭДО не включён на этом контуре';
  }
  return fallback;
}

export async function apiErrorCode(e: unknown): Promise<string | null> {
  if (!(e instanceof HTTPError)) return null;
  try {
    const body = (await e.response.clone().json()) as { detail?: { code?: string } };
    return body.detail?.code ?? null;
  } catch {
    return null;
  }
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Отпечаток ключа группами по 4 символа — так его проще сверять глазами. */
export function groupFingerprint(fp: string): string {
  return fp.replace(/(.{4})/g, '$1 ').trim();
}

export function docLabel(d: { title: string; number?: string | null }): string {
  return d.number ? `${d.title} № ${d.number}` : d.title;
}

export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/** `+79991234567` → `+7 999 123-45-67`. */
export function formatPhone(phone?: string | null): string {
  if (!phone) return '—';
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}
