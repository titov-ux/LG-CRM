import { useMemo, useState } from 'react';
import { Calendar as CalendarIcon, ChevronDown } from 'lucide-react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { ru } from 'date-fns/locale';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  COMPARE_LABEL,
  PRESET_LABEL,
  type CompareMode,
  type PeriodPreset,
  resolvePeriod,
  useAnalyticsPeriod,
} from '@/stores/analyticsPeriod';

const PRESETS: PeriodPreset[] = [
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
];

const COMPARE_MODES: CompareMode[] = ['prev', 'yoy', 'none'];

function formatRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  // Верхняя граница периода — exclusive, для подписи показываем «до − 1 день».
  const toInclusive = new Date(to.getTime() - 1);
  const sameYear = from.getFullYear() === toInclusive.getFullYear();
  const fmtFrom = sameYear ? 'd MMM' : 'd MMM yyyy';
  const fmtTo = 'd MMM yyyy';
  return `${format(from, fmtFrom, { locale: ru })} — ${format(toInclusive, fmtTo, { locale: ru })}`;
}

export function PeriodPicker() {
  const { preset, custom, compare, setPreset, setCustom, setCompare } =
    useAnalyticsPeriod();
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() => {
    if (preset === 'custom' && custom) {
      return { from: new Date(custom.from), to: new Date(custom.to) };
    }
    return undefined;
  });

  const resolved = useMemo(() => resolvePeriod(preset, custom), [preset, custom]);
  const label =
    preset === 'custom'
      ? formatRange(resolved.from, resolved.to)
      : PRESET_LABEL[preset];

  const applyCustom = () => {
    if (draft?.from && draft?.to) {
      // делаем верхнюю границу exclusive (начало следующего дня)
      const to = new Date(draft.to);
      to.setHours(0, 0, 0, 0);
      to.setDate(to.getDate() + 1);
      const from = new Date(draft.from);
      from.setHours(0, 0, 0, 0);
      setCustom({ from: from.toISOString(), to: to.toISOString() });
      setCustomOpen(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-[12.5px] font-medium"
          >
            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
            {label}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {PRESETS.map((p) => (
            <DropdownMenuItem
              key={p}
              onClick={() => setPreset(p)}
              className={cn(preset === p && 'bg-accent font-medium')}
            >
              {PRESET_LABEL[p]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setCustomOpen(true);
                }}
                className={cn(preset === 'custom' && 'bg-accent font-medium')}
              >
                {PRESET_LABEL.custom}
              </DropdownMenuItem>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="left"
              className="w-auto p-0"
            >
              <DayPicker
                mode="range"
                locale={ru}
                weekStartsOn={1}
                numberOfMonths={2}
                selected={draft}
                onSelect={setDraft}
                showOutsideDays
                className="p-3"
                classNames={{
                  months: 'flex flex-col sm:flex-row gap-2',
                  month: 'flex flex-col gap-3',
                  caption: 'flex justify-center pt-1 relative items-center w-full',
                  caption_label: 'text-sm font-medium capitalize',
                  nav: 'flex items-center gap-1',
                  nav_button: cn(
                    buttonVariants({ variant: 'outline' }),
                    'size-7 bg-transparent p-0 opacity-70 hover:opacity-100',
                  ),
                  nav_button_previous: 'absolute left-1',
                  nav_button_next: 'absolute right-1',
                  table: 'w-full border-collapse space-x-1',
                  head_row: 'flex',
                  head_cell:
                    'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
                  row: 'flex w-full mt-2',
                  cell: cn(
                    'relative p-0 text-center text-sm',
                    '[&:has([aria-selected])]:bg-accent/40',
                  ),
                  day: cn(
                    buttonVariants({ variant: 'ghost' }),
                    'size-8 p-0 font-normal aria-selected:opacity-100',
                  ),
                  day_range_start:
                    'bg-primary text-primary-foreground rounded-l-md',
                  day_range_end:
                    'bg-primary text-primary-foreground rounded-r-md',
                  day_range_middle: 'bg-accent text-foreground',
                  day_today: 'underline',
                  day_outside: 'text-muted-foreground/60',
                  day_disabled: 'text-muted-foreground opacity-50',
                  day_hidden: 'invisible',
                  vhidden: 'sr-only',
                }}
              />
              <div className="flex items-center justify-end gap-2 border-t p-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(undefined);
                    setCustomOpen(false);
                  }}
                >
                  Отмена
                </Button>
                <Button
                  size="sm"
                  onClick={applyCustom}
                  disabled={!draft?.from || !draft?.to}
                >
                  Применить
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-[12.5px] font-medium text-muted-foreground"
          >
            {COMPARE_LABEL[compare]}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {COMPARE_MODES.map((m) => (
            <DropdownMenuItem
              key={m}
              onClick={() => setCompare(m)}
              className={cn(compare === m && 'bg-accent font-medium')}
            >
              {COMPARE_LABEL[m]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
