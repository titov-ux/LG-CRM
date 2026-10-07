import type { Lead } from '@/api/types';
import type { LeadFormValues } from './LeadForm';

/** Компактный формат суммы: 12,5 млн / 940 тыс / 4 500 ₽. */
export function formatCompactRub(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m.toLocaleString('ru-RU', { maximumFractionDigits: m < 10 ? 1 : 0 })} млн ₽`;
  }
  if (value >= 100_000) {
    return `${Math.round(value / 1000).toLocaleString('ru-RU')} тыс ₽`;
  }
  return `${value.toLocaleString('ru-RU')} ₽`;
}

export function parseISODate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysUntil(iso?: string | null): number | null {
  const target = parseISODate(iso);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Значения формы → payload API (пустые строки → null). */
export function leadFormToPayload(values: LeadFormValues): Partial<Lead> {
  const str = (v: string | undefined) => v?.trim() || null;
  return {
    company: values.company.trim(),
    title: values.title.trim(),
    industry: str(values.industry),
    website: str(values.website),
    contactName: str(values.contactName),
    contactPosition: str(values.contactPosition),
    phone: str(values.phone),
    email: str(values.email),
    telegram: str(values.telegram),
    source: str(values.source),
    expectedValue:
      values.expectedValue === undefined || Number.isNaN(values.expectedValue)
        ? null
        : values.expectedValue,
    nextContactDate: values.nextContactDate || null,
    priority: values.priority,
    accountManagerId: values.accountManagerId || null,
    note: str(values.note),
  };
}

export function leadToForm(l: Lead): Partial<LeadFormValues> {
  return {
    company: l.company,
    title: l.title,
    industry: l.industry ?? '',
    website: l.website ?? '',
    contactName: l.contactName ?? '',
    contactPosition: l.contactPosition ?? '',
    phone: l.phone ?? '',
    email: l.email ?? '',
    telegram: l.telegram ?? '',
    source: l.source ?? '',
    expectedValue: l.expectedValue ?? undefined,
    nextContactDate: l.nextContactDate ?? '',
    priority: l.priority,
    accountManagerId: l.accountManagerId ?? '',
    note: l.note ?? '',
  };
}
