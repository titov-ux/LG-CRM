import { useMemo } from 'react';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { cn } from '@/lib/utils';
import type { CalendarEvent, EventStatus } from '@/api/types';

const STATUS_DOT: Record<EventStatus, string> = {
  scheduled: 'bg-blue-500',
  held: 'bg-emerald-500',
  no_show: 'bg-red-500',
  canceled: 'bg-muted-foreground/40',
};

interface Props {
  anchor: Date;
  events: CalendarEvent[];
  onOpenEvent: (e: CalendarEvent) => void;
  onCreateAt: (date: Date) => void;
}

export function MonthGrid({ anchor, events, onOpenEvent, onCreateAt }: Props) {
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [anchor]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = format(new Date(ev.startsAt), 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-background">
      <div className="grid grid-cols-7 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, anchor);
          const today = isSameDay(day, new Date());
          return (
            <div
              key={key}
              className={cn(
                'min-h-[96px] border-b border-r p-1.5 text-left',
                !inMonth && 'bg-muted/20 text-muted-foreground',
              )}
              onClick={() => onCreateAt(day)}
              role="button"
            >
              <div className="mb-1">
                <span
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                    today && 'bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map((ev) => (
                  <button
                    key={ev.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenEvent(ev);
                    }}
                    className={cn(
                      'flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted',
                      ev.status === 'canceled' && 'line-through opacity-60',
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[ev.status])} />
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {format(new Date(ev.startsAt), 'HH:mm')}
                    </span>
                    <span className="truncate">{ev.candidateName ?? ev.title}</span>
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <div className="px-1 text-[11px] text-muted-foreground">
                    ещё {dayEvents.length - 3}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
