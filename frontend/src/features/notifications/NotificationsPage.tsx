import { useMemo, useState } from 'react';
import {
  AtSign,
  Bell,
  CalendarRange,
  CheckCheck,
  Inbox,
  Search,
  Tag,
  Eye,
  UserPlus,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DateField } from '@/components/forms/DateField';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar, FilterChip, MenuItem } from '@/components/common/FilterChip';
import { useNotifications, useMarkAllRead, useMarkRead } from './hooks';
import { cn } from '@/lib/utils';
import type { Notification } from '@/api/types';

// === Локализация ===

const KIND_ICON = {
  mention: AtSign,
  status_change: Bell,
  system: Bell,
  assignment: UserPlus,
  comment: MessageSquare,
  chat_message: MessageSquare,
};

const KIND_LABEL: Record<Notification['kind'], string> = {
  mention: 'Упоминания',
  status_change: 'Смена статуса',
  system: 'Системные',
  assignment: 'Назначения',
  comment: 'Комментарии',
  chat_message: 'Сообщения в чате',
};

const KIND_OPTIONS: Notification['kind'][] = [
  'mention',
  'chat_message',
  'comment',
  'status_change',
  'assignment',
  'system',
];

const ENTITY_LABEL: Record<string, string> = {
  candidate: 'Кандидат',
  vacancy: 'Вакансия',
  client: 'Клиент',
  contact: 'Контакт',
};

const ENTITY_LABEL_PLURAL: Record<string, string> = {
  candidate: 'Кандидаты',
  vacancy: 'Вакансии',
  client: 'Клиенты',
  contact: 'Контакты',
};

const ENTITY_OPTIONS = ['candidate', 'vacancy', 'client', 'contact'] as const;

type ReadFilter = 'all' | 'unread' | 'read';

const READ_LABEL: Record<ReadFilter, string> = {
  all: 'Все',
  unread: 'Непрочитанные',
  read: 'Прочитанные',
};

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

// === Состояние фильтров ===

interface Filters {
  search: string;
  kind: Notification['kind'] | null;
  entityType: string | null;
  read: ReadFilter;
  dateFrom: string;
  dateTo: string;
}

const EMPTY: Filters = {
  search: '',
  kind: null,
  entityType: null,
  read: 'all',
  dateFrom: '',
  dateTo: '',
};

// === Страница ===

export function NotificationsPage() {
  const { data, isLoading } = useNotifications();
  const markAll = useMarkAllRead();
  const markOne = useMarkRead();

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((p) => ({ ...p, [k]: v }));

  const filtered = useMemo(() => {
    const list = data ?? [];
    const q = filters.search.trim().toLowerCase();
    const from = filters.dateFrom ? new Date(filters.dateFrom).getTime() : null;
    const to = filters.dateTo
      ? new Date(filters.dateTo).getTime() + 24 * 60 * 60 * 1000 - 1
      : null;

    return list.filter((n) => {
      if (filters.kind && n.kind !== filters.kind) return false;
      if (filters.entityType && n.entityType !== filters.entityType) return false;
      if (filters.read === 'unread' && n.read) return false;
      if (filters.read === 'read' && !n.read) return false;
      if (q && !n.text.toLowerCase().includes(q)) return false;
      if (from !== null || to !== null) {
        const t = new Date(n.createdAt).getTime();
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
      }
      return true;
    });
  }, [data, filters]);

  const totalCount = filtered.length;

  const hasActiveFilters =
    !!filters.kind ||
    !!filters.entityType ||
    filters.read !== 'all' ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    !!filters.search.trim();

  const periodLabel = (() => {
    const { dateFrom: f, dateTo: t } = filters;
    if (!f && !t) return null;
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    if (f && t) return `${fmt(f)} – ${fmt(t)}`;
    if (f) return `с ${fmt(f)}`;
    return `до ${fmt(t)}`;
  })();

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
      {/* Поиск */}
      <div className="relative mb-2 -mx-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder="Поиск по тексту уведомления"
          className="h-9 border-transparent bg-transparent pl-8 text-[13.5px] shadow-none placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:bg-muted/40 focus-visible:ring-0"
        />
      </div>

      {/* Inline filter bar */}
      <FilterBar
        hasActiveFilters={hasActiveFilters}
        onReset={() => setFilters(EMPTY)}
        rightSlot={
          <div className="flex items-center gap-3">
            <span className="tnum text-[11.5px] text-muted-foreground/80">
              {totalCount}{' '}
              {pluralize(totalCount, ['уведомление', 'уведомления', 'уведомлений'])}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-[12px]"
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Прочитать все
            </Button>
          </div>
        }
      >
        <FilterChip
          active={!!filters.kind}
          icon={Bell}
          label="Тип"
          value={filters.kind ? KIND_LABEL[filters.kind] : null}
          onClear={() => set('kind', null)}
        >
          <MenuItem selected={!filters.kind} onClick={() => set('kind', null)}>
            Все
          </MenuItem>
          {KIND_OPTIONS.map((opt) => (
            <MenuItem
              key={opt}
              selected={filters.kind === opt}
              onClick={() => set('kind', opt)}
            >
              {KIND_LABEL[opt]}
            </MenuItem>
          ))}
        </FilterChip>

        <FilterChip
          active={!!filters.entityType}
          icon={Tag}
          label="Сущность"
          value={filters.entityType ? ENTITY_LABEL[filters.entityType] : null}
          onClear={() => set('entityType', null)}
        >
          <MenuItem
            selected={!filters.entityType}
            onClick={() => set('entityType', null)}
          >
            Все
          </MenuItem>
          {ENTITY_OPTIONS.map((opt) => (
            <MenuItem
              key={opt}
              selected={filters.entityType === opt}
              onClick={() => set('entityType', opt)}
            >
              {ENTITY_LABEL_PLURAL[opt]}
            </MenuItem>
          ))}
        </FilterChip>

        <FilterChip
          active={filters.read !== 'all'}
          icon={Eye}
          label="Статус"
          value={filters.read !== 'all' ? READ_LABEL[filters.read] : null}
          onClear={() => set('read', 'all')}
        >
          {(['all', 'unread', 'read'] as ReadFilter[]).map((opt) => (
            <MenuItem
              key={opt}
              selected={filters.read === opt}
              onClick={() => set('read', opt)}
            >
              {READ_LABEL[opt]}
            </MenuItem>
          ))}
        </FilterChip>

        <FilterChip
          active={!!filters.dateFrom || !!filters.dateTo}
          icon={CalendarRange}
          label="Период"
          value={periodLabel}
          onClear={() => {
            set('dateFrom', '');
            set('dateTo', '');
          }}
        >
          <div className="space-y-2 p-1">
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                С даты
              </div>
              <DateField
                value={filters.dateFrom}
                onChange={(v) => set('dateFrom', v)}
                className="h-8"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                По дату
              </div>
              <DateField
                value={filters.dateTo}
                onChange={(v) => set('dateTo', v)}
                className="h-8"
              />
            </div>
          </div>
        </FilterChip>
      </FilterBar>

      {/* Список */}
      {isLoading ? (
        <Card className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4">
              <Skeleton className="h-5" />
            </div>
          ))}
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={hasActiveFilters ? 'По заданным фильтрам ничего не найдено' : 'Уведомлений нет'}
        />
      ) : (
        <Card className="divide-y">
          {filtered.map((n) => {
            const Icon = KIND_ICON[n.kind];
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => markOne.mutate(n.id)}
                className={cn(
                  'flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50',
                  !n.read && 'bg-blue-50/40',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full',
                    n.read ? 'bg-muted text-muted-foreground' : 'bg-blue-100 text-blue-700',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="flex-1">
                  <div className="text-sm">{n.text}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString('ru-RU')}
                  </div>
                </div>
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}
