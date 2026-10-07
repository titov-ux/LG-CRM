import type { LeadStatus, Priority } from '@/api/types';
import type { KanbanStatusDescriptor } from '@/components/kanban/types';

// Колонки канбана лидов. Пайплайн:
// Новый → Первый контакт → Квалифицирован → КП отправлено → Переговоры → Сделка / Отказ.
export const leadStatuses: KanbanStatusDescriptor<LeadStatus>[] = [
  { id: 'new', label: 'Новый', color: '#94a3b8' },
  { id: 'contacted', label: 'Первый контакт', color: '#3b82f6' },
  { id: 'qualified', label: 'Квалифицирован', color: '#06b6d4' },
  { id: 'proposal', label: 'КП отправлено', color: '#8b5cf6' },
  { id: 'negotiation', label: 'Переговоры', color: '#f59e0b' },
  { id: 'won', label: 'Сделка', color: '#10b981' },
  { id: 'lost', label: 'Отказ', color: '#ef4444' },
];

// Финальные статусы — перевод в них на бэке требует обязательного комментария
// (см. backend/app/modules/leads/transitions.py: FINAL_STATUSES).
export const FINAL_LEAD_STATUSES: readonly LeadStatus[] = ['won', 'lost'];

export function isFinalLeadStatus(status: LeadStatus): boolean {
  return FINAL_LEAD_STATUSES.includes(status);
}

export function leadStatusLabel(status: LeadStatus): string {
  return leadStatuses.find((s) => s.id === status)?.label ?? status;
}

// Подсказки источников лида — используются в форме (datalist) и фильтре.
export const LEAD_SOURCES: string[] = [
  'Сайт',
  'Рекомендация',
  'Холодный звонок',
  'Email-рассылка',
  'Мероприятие',
  'Соцсети',
  'LinkedIn',
  'Партнёр',
  'Повторное обращение',
];

/** Цвет левого акцента карточки — по приоритету. */
export const LEAD_PRIORITY_COLOR: Record<Priority, string> = {
  urgent: '#ef4444',
  high: '#f59e0b',
  medium: '#94a3b8',
  low: '#cbd5e1',
};
