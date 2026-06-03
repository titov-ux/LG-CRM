import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { WorklogSummaryResponse } from '@/api/analytics';
import type { User } from '@/api/types';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useUsers } from '@/features/users/hooks';
import { cn } from '@/lib/utils';

type SortKey =
  | 'fullName'
  | 'totalSeconds'
  | 'totalActiveSeconds'
  | 'sessionsCount';

interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  width?: string;
}

const COLUMNS: Column[] = [
  { key: 'fullName', label: 'Сотрудник', align: 'left', width: 'minmax(180px, 1.6fr)' },
  { key: 'totalSeconds', label: 'В системе', align: 'right', width: 'minmax(200px, 1fr)' },
  { key: 'totalActiveSeconds', label: 'Активно', align: 'right', width: 'minmax(130px, auto)' },
  { key: 'sessionsCount', label: 'Сессий', align: 'right', width: 'minmax(76px, auto)' },
];

interface WorklogTableProps {
  data: WorklogSummaryResponse | undefined;
  isLoading?: boolean;
}

/** Секунды → «3 ч 42 мин» / «42 мин» / «< 1 мин». */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 60) return seconds > 0 ? '< 1 мин' : '—';
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

export function WorklogTable({ data, isLoading }: WorklogTableProps) {
  const { data: users } = useUsers();
  const [sortKey, setSortKey] = useState<SortKey>('totalSeconds');
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

  const maxSeconds = useMemo(
    () => Math.max(1, ...(data?.items ?? []).map((i) => i.totalSeconds)),
    [data],
  );
  const totalSeconds = useMemo(
    () => (data?.items ?? []).reduce((acc, i) => acc + i.totalSeconds, 0),
    [data],
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
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

  const gridCols = COLUMNS.map((c) => c.width ?? 'auto').join(' ');

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
      </div>

      {/* Rows */}
      <div className="divide-y">
        {sorted.map((r) => {
          const user = usersById[r.userId];
          const pct = Math.round((r.totalSeconds / maxSeconds) * 100);
          return (
            <div
              key={r.userId}
              className="grid items-center gap-3 py-2 text-[12.5px]"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="flex items-center gap-2 truncate">
                {user ? <UserAvatar user={user} size={24} /> : null}
                <span className="truncate font-medium">{r.fullName}</span>
              </div>
              {/* Время + относительная полоска */}
              <div className="flex items-center justify-end gap-2">
                <div className="hidden h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-muted sm:block">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="tnum w-[92px] text-right font-semibold">
                  {formatDuration(r.totalSeconds)}
                </span>
              </div>
              {/* Активное время + доля от online */}
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="tnum font-medium">
                  {formatDuration(r.totalActiveSeconds)}
                </span>
                {r.totalSeconds > 0 && r.totalActiveSeconds > 0 && (
                  <span className="tnum text-[10.5px] text-muted-foreground">
                    {Math.round((r.totalActiveSeconds / r.totalSeconds) * 100)}%
                  </span>
                )}
              </div>
              <div className="tnum text-right text-muted-foreground">
                {r.sessionsCount}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: итог */}
      {sorted.length > 1 && (
        <div
          className="mt-1 grid items-center gap-3 border-t pt-2 text-[12px] font-medium"
          style={{ gridTemplateColumns: gridCols }}
        >
          <span className="text-muted-foreground">Итого ({sorted.length})</span>
          <span className="tnum text-right">{formatDuration(totalSeconds)}</span>
          <span className="tnum text-right">
            {formatDuration(
              sorted.reduce((acc, i) => acc + i.totalActiveSeconds, 0),
            )}
          </span>
          <span className="tnum text-right text-muted-foreground">
            {sorted.reduce((acc, i) => acc + i.sessionsCount, 0)}
          </span>
        </div>
      )}
    </div>
  );
}
