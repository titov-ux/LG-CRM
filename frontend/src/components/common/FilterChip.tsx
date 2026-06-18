import { Check, ChevronDown, Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFiltersStore } from '@/stores/filters';
import { cn } from '@/lib/utils';

// === FilterChip ===
// Чип-фильтр с поповером, унифицированный для всех страниц со списками
// (журнал действий, контакты, клиенты и т.д.). При active=true чип подсвечен
// и показывает выбранное значение; при отсутствии выбранного значения —
// «пустая» подсказка с шевроном.

export function FilterChip({
  active,
  icon: Icon,
  label,
  value,
  onClear,
  children,
  contentClassName,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
  onClear?: () => void;
  children: React.ReactNode;
  contentClassName?: string;
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
      <PopoverContent align="start" className={cn('w-60 p-1.5', contentClassName)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

// === MenuItem ===
// Строка-пункт меню внутри FilterChip. Поддерживает «галочку» для выбранного
// варианта.
export function MenuItem({
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
      <span className="truncate">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
    </button>
  );
}

// === FilterBar ===
// Контейнер для строки фильтров: опциональный левый слот (например, primary-action),
// иконка-лейбл «Фильтр», слот для чипов и правый блок (счётчик + «Сбросить»).
export function FilterBar({
  children,
  leftSlot,
  rightSlot,
  onReset,
  hasActiveFilters,
  globalSearch = false,
  searchPlaceholder = 'Поиск…',
}: {
  children: React.ReactNode;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  /**
   * Показать строку поиска, привязанную к общему стору фильтров. На desktop
   * поиск живёт в шапке; на мобильном шапочный поиск скрыт, поэтому страницы
   * со списками/канбанами включают этот флаг, чтобы поиск был доступен.
   * Поле рендерится только на узких экранах (md:hidden).
   */
  globalSearch?: boolean;
  searchPlaceholder?: string;
}) {
  return (
    <>
      {globalSearch && <MobileGlobalSearch placeholder={searchPlaceholder} />}
      <div className="mb-3 flex flex-wrap items-center gap-1 -mx-1 px-1 text-[12px]">
      {leftSlot && (
        <>
          <div className="flex items-center pr-1">{leftSlot}</div>
          <span className="mr-1 h-5 w-px bg-border" aria-hidden />
        </>
      )}
      <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-muted-foreground">
        <Filter className="h-3.5 w-3.5" />
        <span>Фильтр</span>
      </span>
      {children}
      <div className="ml-auto flex items-center gap-2">
        {rightSlot}
        {hasActiveFilters && onReset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-7 gap-1 px-2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Сбросить
          </Button>
        )}
      </div>
      </div>
    </>
  );
}

// === MobileGlobalSearch ===
// Поле поиска для мобильных экранов, привязанное к общему стору фильтров.
// На desktop (md+) скрыто — там поиск находится в шапке.
function MobileGlobalSearch({ placeholder }: { placeholder?: string }) {
  const search = useFiltersStore((s) => s.search);
  const setSearch = useFiltersStore((s) => s.setSearch);
  return (
    <div className="relative mb-2 md:hidden">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        className="h-9 pl-8 text-[13px]"
      />
    </div>
  );
}
