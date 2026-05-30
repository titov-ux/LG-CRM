import { useEffect, useMemo, useRef, useState } from 'react';
import { format, getISOWeek, isSameDay, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { CalendarEvent, EventStatus } from '@/api/types';

const HOUR_PX = 72; // высота одного часа в сетке (крупнее — комфортнее)
const GUTTER = 56; // ширина левого жёлоба с часами (px), = w-14
const SCROLL_TO_HOUR = 8; // стартовый скролл к рабочему утру

const STATUS_STYLE: Record<EventStatus, string> = {
  scheduled: 'bg-blue-50 border-blue-300 text-blue-900',
  held: 'bg-emerald-50 border-emerald-300 text-emerald-900',
  no_show: 'bg-red-50 border-red-300 text-red-900',
  canceled: 'bg-muted border-border text-muted-foreground line-through',
};

interface Props {
  /** Дни, отображаемые колонками (1 — день, 7 — неделя). */
  days: Date[];
  events: CalendarEvent[];
  onOpenEvent: (e: CalendarEvent) => void;
  onCreateAt: (date: Date) => void;
}

/** Почасовая сетка день/неделя в стиле Яндекс.Календаря (Notion-эстетика). */
export function TimeGrid({ days, events, onOpenEvent, onCreateAt }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX;
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const totalHeight = 24 * HOUR_PX;

  // Таймзона пользователя в формате UTC±H.
  const tzLabel = useMemo(() => {
    const offMin = -new Date().getTimezoneOffset();
    const sign = offMin >= 0 ? '+' : '−';
    const h = Math.floor(Math.abs(offMin) / 60);
    const m = Math.abs(offMin) % 60;
    return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
  }, []);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = format(new Date(ev.startsAt), 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  function handleColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = Math.floor((offsetY / HOUR_PX) * 60);
    const snapped = Math.round(minutes / 30) * 30;
    const d = startOfDay(day);
    d.setMinutes(snapped);
    onCreateAt(d);
  }

  const nowOffset = (now.getHours() + now.getMinutes() / 60) * HOUR_PX;
  const todayIndex = days.findIndex((d) => isSameDay(d, now));

  // Единый шаблон колонок для шапки и тела — grid считает дорожки одинаково,
  // поэтому вертикальные линии совпадают пиксель в пиксель (в отличие от flex-1,
  // где subpixel-остатки накапливались к правому краю).
  const gridCols = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Единый скролл-контейнер: шапка (sticky) и тело делят одну ширину,
          поэтому скроллбар одинаково отъедает место у колонок шапки и тела. */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {/* Шапка дней — приклеена к верху */}
        <div className="sticky top-0 z-30 grid border-b bg-background" style={{ gridTemplateColumns: gridCols }}>
          <div className="flex items-end justify-center border-r pb-1 text-[11px] text-muted-foreground">
            {tzLabel}
          </div>
          {days.map((day) => {
            const today = isSameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'flex items-center justify-center gap-1.5 border-r py-2 text-sm last:border-r-0',
                  today ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="lowercase">{format(day, 'EEEEEE', { locale: ru })}</span>
                <span
                  className={cn(
                    'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-semibold',
                    today ? 'bg-red-500 text-white' : 'text-foreground',
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>
            );
          })}
        </div>

        {/* Сетка часов */}
        <div className="relative grid" style={{ gridTemplateColumns: gridCols, height: totalHeight }}>
          {/* Колонка часов + номер недели */}
          <div className="relative border-r">
            <span className="absolute right-1.5 top-1 text-[11px] text-muted-foreground">
              {getISOWeek(days[0])} нед.
            </span>
            {hours.map((h) => (
              <div key={h} className="relative" style={{ height: HOUR_PX }}>
                {h > 0 && (
                  <span className="absolute -top-2 right-1.5 text-[11px] tabular-nums text-muted-foreground">
                    {String(h).padStart(2, '0')}:00
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Колонки дней */}
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDay.get(key) ?? [];
            const today = isSameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'relative border-r last:border-r-0',
                  today && 'bg-muted/30',
                )}
                onClick={(e) => handleColumnClick(day, e)}
                role="button"
                aria-label={`Создать собеседование ${format(day, 'd MMMM', { locale: ru })}`}
              >
                {hours.map((h) => (
                  <div key={h} className="border-b border-border/60" style={{ height: HOUR_PX }} />
                ))}
                {dayEvents.map((ev) => (
                  <EventBlock key={ev.id} event={ev} onOpen={onOpenEvent} />
                ))}
              </div>
            );
          })}

          {/* Линия «сейчас»: через всю ширину, жирный сегмент — на колонке сегодня */}
          {todayIndex >= 0 && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
              style={{ top: nowOffset }}
            >
              <span
                className="shrink-0 pr-1 text-right text-[11px] font-medium tabular-nums text-red-500"
                style={{ width: GUTTER }}
              >
                {format(now, 'HH:mm')}
              </span>
              {/* Обычная линия через всю сетку */}
              <span className="relative h-px flex-1 bg-red-500">
                {/* Жирный сегмент + точка на колонке сегодня */}
                <span
                  className="absolute -top-[1px] h-[3px] bg-red-500"
                  style={{
                    left: `calc((100% / ${days.length}) * ${todayIndex})`,
                    width: `calc(100% / ${days.length})`,
                  }}
                >
                  <span className="absolute -left-[3px] -top-[3px] h-[8px] w-[8px] rounded-full bg-red-500" />
                </span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EventBlock({
  event,
  onOpen,
}: {
  event: CalendarEvent;
  onOpen: (e: CalendarEvent) => void;
}) {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 60 * 60_000);
  const top = (start.getHours() + start.getMinutes() / 60) * HOUR_PX;
  const durationH = Math.max(0.5, (end.getTime() - start.getTime()) / 3_600_000);
  const height = durationH * HOUR_PX;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpen(event);
      }}
      className={cn(
        'absolute left-1 right-1 z-10 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] shadow-sm transition-shadow hover:shadow',
        STATUS_STYLE[event.status],
      )}
      style={{ top, height }}
    >
      <div className="font-medium leading-tight">{format(start, 'HH:mm')}</div>
      <div className="truncate leading-tight">{event.candidateName ?? event.title}</div>
    </button>
  );
}

export { HOUR_PX };
