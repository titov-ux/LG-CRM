import { useMemo, useState } from 'react';
import {
  CalendarRange,
  Check,
  ChevronDown,
  Filter,
  ListFilter,
  Search,
  Tag,
  User as UserIcon,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useAudit } from './hooks';
import { useUsers } from '@/features/users/hooks';

// === Локализация ===

const ENTITY_LABEL: Record<string, string> = {
  candidate: 'Кандидат',
  vacancy: 'Вакансия',
  client: 'Клиент',
};

const ENTITY_LABEL_PLURAL: Record<string, string> = {
  candidate: 'Кандидаты',
  vacancy: 'Вакансии',
  client: 'Клиенты',
};

const FIELD_LABEL: Record<string, string> = {
  status: 'Статус',
  priority: 'Приоритет',
  grade: 'Грейд',
  salary: 'Зарплата',
};

const FIELD_OPTIONS = ['status', 'priority', 'grade', 'salary'] as const;
const ENTITY_OPTIONS = ['candidate', 'vacancy', 'client'] as const;

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
  entityType: string | null;
  field: string | null;
  actorId: string | null;
  dateFrom: string;
  dateTo: string;
}

const EMPTY: Filters = {
  search: '',
  entityType: null,
  field: null,
  actorId: null,
  dateFrom: '',
  dateTo: '',
};

// === Чип-фильтр с поповером ===

function FilterChip({
  active,
  icon: Icon,
  label,
  value,
  onClear,
  children,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <div
        className={cn(
          'group inline-flex h-7 items-center rounded-md border text-[12px] transition-colors',
          active
            ? 'border-foreground/15 bg-foreground/[0.04] text-foreground'
            : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-full items-center gap-1.5 px-2 outline-none"
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
            {active && value && (
              <>
                <span className="text-muted-foreground/60">:</span>
                <span className="font-medium">{value}</span>
              </>
            )}
            {!active && <ChevronDown className="h-3 w-3 opacity-60" />}
          </button>
        </PopoverTrigger>
        {active && onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Сбросить фильтр «${label}»`}
            className="flex h-full items-center px-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-60 p-1.5">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-muted"
    >
      <span>{children}</span>
      {selected && <Check className="h-3.5 w-3.5 text-foreground" />}
    </button>
  );
}

// === Страница ===

export function AuditPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((p) => ({ ...p, [k]: v }));

  const queryParams = useMemo(
    () => ({
      entityType: filters.entityType ?? undefined,
      actorId: filters.actorId ?? undefined,
      field: filters.field ?? undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      search: filters.search.trim() || undefined,
    }),
    [filters],
  );

  const { data, isLoading } = useAudit(queryParams);
  const { data: users } = useUsers();

  const rows = data ?? [];
  const totalCount = rows.length;

  const hasActiveFilters =
    !!filters.entityType ||
    !!filters.field ||
    !!filters.actorId ||
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

  const actorLabel = filters.actorId
    ? users?.find((u) => u.id === filters.actorId)?.fullName ?? '—'
    : null;

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
      {/* Поиск */}
      <div className="relative mb-2 -mx-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder="Поиск по полю, значению или ID"
          className="h-9 border-transparent bg-transparent pl-8 text-[13.5px] shadow-none placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:bg-muted/40 focus-visible:ring-0"
        />
      </div>

      {/* Inline filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-1 -mx-1 px-1 text-[12px]">
        <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <span>Фильтр</span>
        </span>

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
          active={!!filters.field}
          icon={ListFilter}
          label="Поле"
          value={filters.field ? FIELD_LABEL[filters.field] : null}
          onClear={() => set('field', null)}
        >
          <MenuItem selected={!filters.field} onClick={() => set('field', null)}>
            Все
          </MenuItem>
          {FIELD_OPTIONS.map((opt) => (
            <MenuItem
              key={opt}
              selected={filters.field === opt}
              onClick={() => set('field', opt)}
            >
              {FIELD_LABEL[opt]}
            </MenuItem>
          ))}
        </FilterChip>

        <FilterChip
          active={!!filters.actorId}
          icon={UserIcon}
          label="Кто"
          value={actorLabel}
          onClear={() => set('actorId', null)}
        >
          <div className="max-h-64 overflow-y-auto">
            <MenuItem
              selected={!filters.actorId}
              onClick={() => set('actorId', null)}
            >
              Все пользователи
            </MenuItem>
            {(users ?? []).map((u) => (
              <MenuItem
                key={u.id}
                selected={filters.actorId === u.id}
                onClick={() => set('actorId', u.id)}
              >
                {u.fullName}
              </MenuItem>
            ))}
          </div>
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
              <Input
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(e) => set('dateFrom', e.target.value)}
                className="h-8"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                По дату
              </div>
              <Input
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(e) => set('dateTo', e.target.value)}
                className="h-8"
              />
            </div>
          </div>
        </FilterChip>

        <div className="ml-auto flex items-center gap-2">
          <span className="tnum text-[11.5px] text-muted-foreground/80">
            {totalCount} {pluralize(totalCount, ['событие', 'события', 'событий'])}
          </span>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters(EMPTY)}
              className="h-7 gap-1 px-2 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Сбросить
            </Button>
          )}
        </div>
      </div>

      {/* Таблица */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Когда</TableHead>
              <TableHead>Кто</TableHead>
              <TableHead>Сущность</TableHead>
              <TableHead>Поле</TableHead>
              <TableHead>Было</TableHead>
              <TableHead>Стало</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  По заданным фильтрам ничего не найдено
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const user = users?.find((u) => u.id === row.actorId);
              return (
                <TableRow key={row.id}>
                  <TableCell className="tnum text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString('ru-RU')}
                  </TableCell>
                  <TableCell>{user?.fullName ?? '—'}</TableCell>
                  <TableCell>
                    {row.entityType} · {row.entityId}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.field}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.before ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.after ?? '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
