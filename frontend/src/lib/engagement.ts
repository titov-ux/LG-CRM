import type { EngagementType } from '@/api/types';

/**
 * Конфигурация UI для типа сделки (аутстафф / кадровое агентство).
 *
 * Идея единой палитры:
 *   - outstaff (синий) — «свои», понятный для нас канал;
 *   - agency  (янтарь) — внешний рынок, шире риск/выше нагрузка на проверку.
 *
 * Цвета подобраны так, чтобы не путаться со статусными цветами
 * (см. vacancyStatuses / candidateStatuses в mocks/db).
 */
export interface EngagementMeta {
  /** Полное название для длинных контекстов (формы, шапка карточки). */
  label: string;
  /** Короткий код для тесных мест (бейдж на канбане). */
  short: 'АФ' | 'КА';
  /** Hex цвета для tailwind-классов, см. ниже. */
  accentClass: string;
  /** Bg/text/ring классы для бейджа. */
  badgeClass: string;
  /** Bg/text/ring классы для крупного чипа в шапке. */
  chipClass: string;
  /** Hex цвета левого border-акцента карточки. */
  borderColor: string;
}

export const ENGAGEMENT_META: Record<EngagementType, EngagementMeta> = {
  outstaff: {
    label: 'Аутстафф',
    short: 'АФ',
    accentClass: 'bg-blue-500',
    badgeClass:
      'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200/70 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/60',
    chipClass:
      'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200/70 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/60',
    borderColor: '#3b82f6',
  },
  agency: {
    label: 'Агентство',
    short: 'КА',
    accentClass: 'bg-amber-500',
    badgeClass:
      'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60',
    chipClass:
      'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60',
    borderColor: '#f59e0b',
  },
};

export const ENGAGEMENT_OPTIONS: Array<{ id: EngagementType; label: string }> = [
  { id: 'outstaff', label: 'Аутстафф' },
  { id: 'agency', label: 'Кадровое агентство' },
];

export function engagementLabel(type: EngagementType): string {
  return ENGAGEMENT_META[type].label;
}
