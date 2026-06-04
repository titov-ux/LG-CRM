import type { TenderLaw, TenderStatus } from '@/api/types';
import type { KanbanStatusDescriptor } from '@/components/kanban/types';

// Колонки канбана тендеров. Пайплайн:
// Лид → Оценка → Заявка → На рассмотрении → Выигран / Проигран.
export const tenderStatuses: KanbanStatusDescriptor<TenderStatus>[] = [
  { id: 'lead', label: 'Лид', color: '#94a3b8' },
  { id: 'evaluation', label: 'Оценка', color: '#3b82f6' },
  { id: 'bid', label: 'Заявка', color: '#8b5cf6' },
  { id: 'review', label: 'На рассмотрении', color: '#f59e0b' },
  { id: 'won', label: 'Выигран', color: '#10b981' },
  { id: 'lost', label: 'Проигран', color: '#ef4444' },
];

// Финальные статусы — перевод в них на бэке требует обязательного комментария
// (см. backend/app/modules/tenders/transitions.py: FINAL_STATUSES).
export const FINAL_TENDER_STATUSES: readonly TenderStatus[] = ['won', 'lost'];

export function isFinalTenderStatus(status: TenderStatus): boolean {
  return FINAL_TENDER_STATUSES.includes(status);
}

export interface TenderLawMeta {
  label: string;
  short: string;
  /** Цвет левого акцента карточки + точка в фильтре. */
  color: string;
  /** Классы бейджа закона. */
  badgeClassName: string;
}

export const TENDER_LAW_META: Record<TenderLaw, TenderLawMeta> = {
  fz44: {
    label: '44-ФЗ',
    short: '44-ФЗ',
    color: '#2563eb',
    badgeClassName: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  },
  fz223: {
    label: '223-ФЗ',
    short: '223-ФЗ',
    color: '#7c3aed',
    badgeClassName: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  },
  commercial: {
    label: 'Коммерческий',
    short: 'Комм.',
    color: '#64748b',
    badgeClassName: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300',
  },
};

export const TENDER_LAW_OPTIONS: { id: TenderLaw; label: string }[] = [
  { id: 'fz44', label: '44-ФЗ' },
  { id: 'fz223', label: '223-ФЗ' },
  { id: 'commercial', label: 'Коммерческий' },
];

// Подсказки по популярным ЭТП — используются в форме (datalist) и фильтре.
export const TENDER_PLATFORMS: string[] = [
  'Сбербанк-АСТ',
  'РТС-тендер',
  'Росэлторг (ЕЭТП)',
  'ЗаказРФ',
  'ТЭК-Торг',
  'ЭТП ГПБ',
  'B2B-Center',
  'Fabrikant',
];
