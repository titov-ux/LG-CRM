import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { RecruiterPerformanceResponse } from '@/api/analytics';
import type { User } from '@/api/types';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useUsers } from '@/features/users/hooks';
import { cn } from '@/lib/utils';

type SortKey =
  | 'fullName'
  | 'candidatesCreated'
  | 'presented'
  | 'hired'
  | 'hireRatePct'
  | 'avgTimeToHireDays'
  | 'totalMargin';

interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  width?: string;
}

const COLUMNS: Column[] = [
  { key: 'fullName', label: 'Рекрутер', align: 'left', width: 'minmax(160px, 1.4fr)' },
  { key: 'candidatesCreated', label: 'Заведено', align: 'right' },
  { key: 'presented', label: 'Презентовано', align: 'right' },
  { key: 'hired', label: 'Наймы', align: 'right' },
  { key: 'hireRatePct', label: 'Hire-rate', align: 'right' },
  { key: 'avgTimeToHireDays', label: 'Avg TTH', align: 'right' },
  { key: 'totalMargin', label: 'Маржа /мес', align: 'right' },
];

interface RecruitersTableProps {
  data: RecruiterPerformanceResponse | undefined;
  isLoading?: boolean;
}

function formatMoney(value: number): string {
  if (value === 0) return '—';
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
  const W = 80;
  const H = 24;
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
  // полупрозрачная заливка под линией
  const fillPath =
    pts.length > 1
      ? `${path} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`
      : '';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-20">
      {fillPath && <path d={fillPath} fill={color} opacity={0.15} />}
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

export function RecruitersTable({ data, isLoading }: RecruitersTableProps) {
  const { data: users } = useUsers();
  const [sortKey, setSortKey] = useState<SortKey>('hired');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const usersById = useMemo(() => {
    const m: Record<string, User> = {};
    (users ?? []).forEach((u) => {
      m[u.id] = u;
    });
    return m;
  }, [users]);

  const sorted = useMemo(() => {
    const items = data?.items ?? [];
    const arr = [...items];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (!data || sorted.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
        Нет данных за выбранный период
      </div>
    );
  }

  const onSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'fullName' ? 'asc' : 'desc');
    }
  };

  const gridCols =
    COLUMNS.map((c) => c.width ?? (c.align === 'right' ? 'minmax(80px, auto)' : 'auto')).join(' ') +
    ' minmax(86px, auto)';

  return (
    <div className="overflow-x-auto">
      {/* Header */}
      <div
        className="grid items-center gap-3 border-b pb-2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: gridCols }}
      >
        {COLUMNS.map((c) => {
          const active = sortKey === c.key;
          const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
          return (
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
        })}
        <span className="text-right">Тренд (8 нед.)</span>
      </div>

      {/* Rows */}
      <div className="divide-y">
        {sorted.map((r) => {
          const user = usersById[r.recruiterId];
          const hireRateTone =
            r.hireRatePct >= 40
              ? 'text-emerald-600'
              : r.hireRatePct >= 20
                ? 'text-amber-600'
                : r.hireRatePct > 0
                  ? 'text-rose-600'
                  : 'text-muted-foreground';
          return (
            <div
              key={r.recruiterId}
              className="grid items-center gap-3 py-2 text-[12.5px]"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="flex items-center gap-2 truncate">
                {user ? <UserAvatar user={user} size={24} /> : null}
                <span className="truncate font-medium">{r.fullName}</span>
              </div>
              <div className="tnum text-right">{r.candidatesCreated}</div>
              <div className="tnum text-right">{r.presented}</div>
              <div className="tnum text-right font-semibold">{r.hired}</div>
              <div className={cn('tnum text-right font-semibold', hireRateTone)}>
                {r.hireRatePct.toFixed(1)}%
              </div>
              <div className="tnum text-right">
                {r.avgTimeToHireDays > 0 ? `${r.avgTimeToHireDays.toFixed(1)} дн.` : '—'}
              </div>
              <div className="tnum text-right">{formatMoney(r.totalMargin)}</div>
              <div className="flex justify-end">
                <Sparkline values={r.sparkline} color={user?.color ?? '#3b82f6'} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
