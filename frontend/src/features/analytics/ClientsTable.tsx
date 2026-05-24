import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Clock,
  Handshake,
} from 'lucide-react';
import type {
  ClientHealthFlag,
  ClientMetric,
  ClientPerformanceResponse,
} from '@/api/analytics';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type SortKey =
  | 'name'
  | 'vacanciesOpen'
  | 'vacanciesClosedInPeriod'
  | 'hiresInPeriod'
  | 'avgTimeToFillDays'
  | 'presentedToHiredPct'
  | 'monthlyMarginRunRate'
  | 'rejectionRatePct'
  | 'daysSinceLastVacancy';

interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  width?: string;
  tooltip?: string;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Клиент', align: 'left', width: 'minmax(220px, 1.6fr)' },
  { key: 'vacanciesOpen', label: 'Откр.', align: 'right', tooltip: 'Открытых вакансий сейчас' },
  { key: 'vacanciesClosedInPeriod', label: 'Закр.', align: 'right', tooltip: 'Закрыто за период' },
  { key: 'hiresInPeriod', label: 'Наймы', align: 'right' },
  { key: 'avgTimeToFillDays', label: 'TTF', align: 'right', tooltip: 'Avg time-to-fill, дни' },
  { key: 'presentedToHiredPct', label: 'Конв.', align: 'right', tooltip: 'presented → hired' },
  { key: 'rejectionRatePct', label: 'Отказы', align: 'right', tooltip: 'Доля отказов' },
  { key: 'monthlyMarginRunRate', label: 'Маржа /мес', align: 'right' },
  { key: 'daysSinceLastVacancy', label: 'Послед. вак.', align: 'right' },
];

const FLAG_LABEL: Record<ClientHealthFlag, string> = {
  stale: 'давно нет вакансий',
  no_open: 'нет открытых',
  high_rejection: 'высокая доля отказов',
  no_vacancies_ever: 'никогда не было вакансий',
};

const FLAG_TONE: Record<ClientHealthFlag, 'bad' | 'warn' | 'info'> = {
  stale: 'warn',
  no_open: 'info',
  high_rejection: 'bad',
  no_vacancies_ever: 'info',
};

interface ClientsTableProps {
  data: ClientPerformanceResponse | undefined;
  isLoading?: boolean;
}

function formatMoney(value: number): string {
  if (!value || value === 0) return '—';
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} млн ₽`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${Math.round(value / 1_000).toLocaleString('ru-RU')} тыс ₽`;
  }
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function Sparkline({ values, color = '#3b82f6' }: { values: number[]; color?: string }) {
  if (!values || values.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const W = 70;
  const H = 22;
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? (W - 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = 1 + i * stepX;
    const y = H - 1 - (v / max) * (H - 2);
    return [x, y] as const;
  });
  const path = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const fillPath =
    pts.length > 1
      ? `${path} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`
      : '';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-5 w-[70px]">
      {fillPath && <path d={fillPath} fill={color} opacity={0.15} />}
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

function HealthChip({ flag }: { flag: ClientHealthFlag }) {
  const tone = FLAG_TONE[flag];
  const toneClass =
    tone === 'bad'
      ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
        : 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        toneClass,
      )}
    >
      <AlertTriangle className="h-2.5 w-2.5" />
      {FLAG_LABEL[flag]}
    </span>
  );
}

export function ClientsTable({ data, isLoading }: ClientsTableProps) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>('hiresInPeriod');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const items = data?.items ?? [];
    const arr = [...items];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      // null trickier — null уходит в конец при desc, в начало при asc
      const an = av == null ? Number.NEGATIVE_INFINITY : Number(av);
      const bn = bv == null ? Number.NEGATIVE_INFINITY : Number(bv);
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (!data || sorted.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
        Нет данных по клиентам
      </div>
    );
  }

  const onSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'name' ? 'asc' : 'desc');
    }
  };

  const gridCols =
    COLUMNS.map((c) => c.width ?? (c.align === 'right' ? 'minmax(72px, auto)' : 'auto')).join(' ') +
    ' minmax(78px, auto)';

  return (
    <TooltipProvider delayDuration={250}>
      <div className="overflow-x-auto">
        <div
          className="grid items-center gap-3 border-b pb-2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: gridCols }}
        >
          {COLUMNS.map((c) => {
            const active = sortKey === c.key;
            const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
            const button = (
              <button
                key={c.key}
                type="button"
                onClick={() => onSort(c.key)}
                className={cn(
                  'inline-flex items-center gap-1 transition hover:text-foreground',
                  c.align === 'right' && 'justify-end text-right',
                  active && 'text-foreground',
                )}
              >
                <span>{c.label}</span>
                <Icon className="h-3 w-3 opacity-60" />
              </button>
            );
            return c.tooltip ? (
              <Tooltip key={c.key}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent className="text-[11px]">{c.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              button
            );
          })}
          <span className="text-right">Тренд</span>
        </div>

        <div className="divide-y">
          {sorted.map((c: ClientMetric) => {
            const convTone =
              c.presentedToHiredPct >= 30
                ? 'text-emerald-600'
                : c.presentedToHiredPct >= 15
                  ? 'text-amber-600'
                  : c.presentedToHiredPct > 0
                    ? 'text-rose-600'
                    : 'text-muted-foreground';
            const rejTone =
              c.rejectionRatePct >= 40
                ? 'text-rose-600'
                : c.rejectionRatePct >= 25
                  ? 'text-amber-600'
                  : 'text-muted-foreground';
            return (
              <div
                key={c.clientId}
                role="button"
                tabIndex={0}
                onClick={() => navigate({ to: '/clients/$id', params: { id: c.clientId } })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    navigate({ to: '/clients/$id', params: { id: c.clientId } });
                  }
                }}
                className="grid cursor-pointer items-center gap-3 py-2 text-[12.5px] transition hover:bg-accent/40"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 truncate font-medium">
                    {c.clientKind === 'intermediary' ? (
                      <Handshake className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    ) : (
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                    )}
                    <span className="truncate">{c.name}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {c.industry && (
                      <span className="text-[10.5px] text-muted-foreground">
                        {c.industry}
                      </span>
                    )}
                    {c.healthFlags.map((f) => (
                      <HealthChip key={f} flag={f} />
                    ))}
                  </div>
                </div>
                <div className="tnum text-right font-semibold">{c.vacanciesOpen}</div>
                <div className="tnum text-right text-muted-foreground">
                  {c.vacanciesClosedInPeriod}
                </div>
                <div className="tnum text-right font-semibold">{c.hiresInPeriod}</div>
                <div className="tnum text-right">
                  {c.avgTimeToFillDays > 0 ? `${c.avgTimeToFillDays.toFixed(0)} дн.` : '—'}
                </div>
                <div className={cn('tnum text-right font-semibold', convTone)}>
                  {c.presentedToHiredPct > 0 ? `${c.presentedToHiredPct.toFixed(1)}%` : '—'}
                </div>
                <div className={cn('tnum text-right', rejTone)}>
                  {c.rejectionRatePct > 0 ? `${c.rejectionRatePct.toFixed(1)}%` : '—'}
                </div>
                <div className="tnum text-right">{formatMoney(c.monthlyMarginRunRate)}</div>
                <div className="tnum flex items-center justify-end gap-1 text-right text-muted-foreground">
                  {c.daysSinceLastVacancy != null ? (
                    <>
                      <Clock className="h-3 w-3" />
                      {c.daysSinceLastVacancy} дн.
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </div>
                <div className="flex justify-end">
                  <Sparkline values={c.sparkline} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
