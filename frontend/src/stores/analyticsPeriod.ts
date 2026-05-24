import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Пресеты периода для дашборда. */
export type PeriodPreset =
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'custom';

export type CompareMode = 'prev' | 'yoy' | 'none';

export interface PeriodRange {
  /** ISO-8601 UTC. Inclusive. */
  from: string;
  /** ISO-8601 UTC. Exclusive верхняя граница. */
  to: string;
}

interface PeriodState {
  preset: PeriodPreset;
  /** Используется только когда preset === 'custom'. */
  custom: PeriodRange | null;
  compare: CompareMode;
  setPreset: (preset: PeriodPreset) => void;
  setCustom: (range: PeriodRange) => void;
  setCompare: (compare: CompareMode) => void;
}

export const useAnalyticsPeriod = create<PeriodState>()(
  persist(
    (set) => ({
      preset: 'thisMonth',
      custom: null,
      compare: 'prev',
      setPreset: (preset) => set({ preset }),
      setCustom: (range) => set({ preset: 'custom', custom: range }),
      setCompare: (compare) => set({ compare }),
    }),
    { name: 'crm-lg:analytics-period' },
  ),
);

// ---------------------------------------------------------------------------
// Resolve preset → конкретные даты
// ---------------------------------------------------------------------------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1, 0, 0, 0, 0);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}

export function resolvePeriod(
  preset: PeriodPreset,
  custom: PeriodRange | null,
  now: Date = new Date(),
): PeriodRange {
  if (preset === 'custom' && custom) return custom;
  const to = now;
  let from: Date;
  switch (preset) {
    case 'last7':
      from = new Date(startOfDay(now).getTime() - 6 * 86400_000);
      break;
    case 'last30':
      from = new Date(startOfDay(now).getTime() - 29 * 86400_000);
      break;
    case 'lastMonth': {
      const cur = startOfMonth(now);
      from = new Date(cur.getFullYear(), cur.getMonth() - 1, 1);
      return { from: from.toISOString(), to: cur.toISOString() };
    }
    case 'thisQuarter':
      from = startOfQuarter(now);
      break;
    case 'thisYear':
      from = startOfYear(now);
      break;
    case 'thisMonth':
    default:
      from = startOfMonth(now);
      break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export const PRESET_LABEL: Record<PeriodPreset, string> = {
  last7: '7 дней',
  last30: '30 дней',
  thisMonth: 'Этот месяц',
  lastMonth: 'Прошлый месяц',
  thisQuarter: 'Квартал',
  thisYear: 'Год',
  custom: 'Период…',
};

export const COMPARE_LABEL: Record<CompareMode, string> = {
  prev: 'vs пред. период',
  yoy: 'vs год назад',
  none: 'без сравнения',
};
