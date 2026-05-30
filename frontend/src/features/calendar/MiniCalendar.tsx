import { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Выбранная (активная) дата основного календаря. */
  selected: Date;
  onSelect: (d: Date) => void;
}

/** Компактный месяц для навигации в левой панели (как у Яндекс.Календаря). */
export function MiniCalendar({ selected, onSelect }: Props) {
  const [month, setMonth] = useState(() => startOfMonth(selected));

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [month]);

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium capitalize">
          {format(month, 'LLLL yyyy', { locale: ru })}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Следующий месяц"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px] text-muted-foreground">
        {['П', 'В', 'С', 'Ч', 'П', 'С', 'В'].map((d, i) => (
          <div key={i} className="py-0.5">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const isSelected = isSameDay(day, selected);
          const today = isSameDay(day, new Date());
          const dim = !isSameMonth(day, month);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelect(day)}
              className={cn(
                'mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[12px] transition-colors',
                dim && 'text-muted-foreground/40',
                !today && !isSelected && 'hover:bg-muted',
                // Сегодня — всегда красный кружок (как в шапке основной сетки).
                today && 'bg-red-500 font-semibold text-white',
                // Выбранный день (не сегодня) — нейтральная заливка.
                isSelected && !today && 'bg-muted font-semibold text-foreground',
              )}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
