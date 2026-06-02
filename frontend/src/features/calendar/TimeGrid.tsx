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
  /** Перетаскивание события на новое время/день. Если не задан — DnD выключен. */
  onMoveEvent?: (event: CalendarEvent, newStartsAt: Date) => void;
}

/** Позиция события внутри колонки дня: индекс дорожки и сколько их в кластере. */
interface Slot {
  col: number;
  cols: number;
}

function evStartMs(ev: CalendarEvent): number {
  return new Date(ev.startsAt).getTime();
}
function evEndMs(ev: CalendarEvent): number {
  const s = evStartMs(ev);
  return ev.endsAt ? new Date(ev.endsAt).getTime() : s + 60 * 60_000;
}

/**
 * Раскладка пересекающихся событий по колонкам. События, перекрывающиеся по
 * времени, образуют кластер и делят ширину дня поровну; непересекающиеся
 * занимают всю ширину. Жадный алгоритм: внутри кластера событие садится в
 * первую свободную дорожку, иначе заводится новая.
 */
function layoutDay(events: CalendarEvent[]): Map<string, Slot> {
  const result = new Map<string, Slot>();
  const sorted = [...events].sort((a, b) => evStartMs(a) - evStartMs(b) || evEndMs(a) - evEndMs(b));

  let cluster: { ev: CalendarEvent; col: number }[] = [];
  let colEnds: number[] = []; // время окончания последнего события в каждой дорожке
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = colEnds.length;
    for (const item of cluster) result.set(item.ev.id, { col: item.col, cols });
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };

  for (const ev of sorted) {
    const s = evStartMs(ev);
    const e = evEndMs(ev);
    // Событие не пересекается с текущим кластером → закрываем кластер.
    if (cluster.length && s >= clusterEnd) flush();

    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(e);
    } else {
      colEnds[col] = e;
    }
    cluster.push({ ev, col });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return result;
}

/** Почасовая сетка день/неделя в стиле Яндекс.Календаря (Notion-эстетика). */
export function TimeGrid({ days, events, onOpenEvent, onCreateAt, onMoveEvent }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
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

  // Раскладка пересекающихся событий по колонкам — для каждого дня отдельно.
  const layoutByDay = useMemo(() => {
    const map = new Map<string, Map<string, Slot>>();
    for (const [key, evs] of eventsByDay) map.set(key, layoutDay(evs));
    return map;
  }, [eventsByDay]);

  // === Drag-and-drop переноса события ===
  const dragRef = useRef<{
    event: CalendarEvent;
    startX: number;
    startY: number;
    grabOffsetY: number;
    durationH: number;
    moved: boolean;
    dayIndex: number;
    topPx: number;
  } | null>(null);
  // Подавляет click сразу после перетаскивания (чтобы не открыть карточку
  // события и не создать новое по клику в колонке).
  const suppressClickRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);
  const [ghost, setGhost] = useState<{
    id: string;
    dayIndex: number;
    topPx: number;
    durationH: number;
    status: EventStatus;
    title: string;
  } | null>(null);

  function beginDrag(event: CalendarEvent, e: React.PointerEvent) {
    if (!onMoveEvent || e.button !== 0 || !bodyRef.current) return;
    const start = new Date(event.startsAt);
    const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 60 * 60_000);
    const durationH = Math.max(0.5, (end.getTime() - start.getTime()) / 3_600_000);
    const blockTop = (start.getHours() + start.getMinutes() / 60) * HOUR_PX;
    const rect = bodyRef.current.getBoundingClientRect();
    const grabOffsetY = e.clientY - rect.top - blockTop;
    const dayIndex = Math.max(0, days.findIndex((d) => isSameDay(d, start)));
    dragRef.current = {
      event,
      startX: e.clientX,
      startY: e.clientY,
      grabOffsetY,
      durationH,
      moved: false,
      dayIndex,
      topPx: blockTop,
    };
    setDragActive(true);
  }

  useEffect(() => {
    if (!dragActive) return;
    const snapPx = (15 / 60) * HOUR_PX; // шаг привязки — 15 минут

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !bodyRef.current) return;
      // До порога в 4px считаем это кликом, а не перетаскиванием.
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
      d.moved = true;
      const rect = bodyRef.current.getBoundingClientRect();
      const colWidth = (rect.width - GUTTER) / days.length;
      let dayIndex = Math.floor((e.clientX - rect.left - GUTTER) / colWidth);
      dayIndex = Math.max(0, Math.min(days.length - 1, dayIndex));
      let topPx = e.clientY - rect.top - d.grabOffsetY;
      topPx = Math.round(topPx / snapPx) * snapPx;
      topPx = Math.max(0, Math.min(24 * HOUR_PX - d.durationH * HOUR_PX, topPx));
      d.dayIndex = dayIndex;
      d.topPx = topPx;
      setGhost({
        id: d.event.id,
        dayIndex,
        topPx,
        durationH: d.durationH,
        status: d.event.status,
        title: d.event.candidateName ?? d.event.title,
      });
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragActive(false);
      setGhost(null);
      if (!d || !d.moved) return;
      // Был именно drag → гасим последующий click и применяем перенос.
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const minutes = Math.round((d.topPx / HOUR_PX) * 60);
      const day = days[d.dayIndex];
      const newStart = new Date(day);
      newStart.setHours(0, minutes, 0, 0);
      if (newStart.getTime() !== new Date(d.event.startsAt).getTime()) {
        onMoveEvent?.(d.event, newStart);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragActive, days, onMoveEvent]);

  function handleColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = Math.floor((offsetY / HOUR_PX) * 60);
    const snapped = Math.round(minutes / 30) * 30;
    const d = startOfDay(day);
    d.setMinutes(snapped);
    onCreateAt(d);
  }

  function handleOpenEvent(ev: CalendarEvent) {
    if (suppressClickRef.current) return;
    onOpenEvent(ev);
  }

  /** Подпись времени по вертикальной позиции (px) — для ghost при перетаскивании. */
  function pxToTimeLabel(topPx: number): string {
    const total = Math.round((topPx / HOUR_PX) * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
        <div ref={bodyRef} className="relative grid" style={{ gridTemplateColumns: gridCols, height: totalHeight }}>
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
            const dayLayout = layoutByDay.get(key);
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
                  <EventBlock
                    key={ev.id}
                    event={ev}
                    slot={dayLayout?.get(ev.id) ?? { col: 0, cols: 1 }}
                    onOpen={handleOpenEvent}
                    onDragStart={onMoveEvent ? (e) => beginDrag(ev, e) : undefined}
                    dimmed={ghost?.id === ev.id}
                  />
                ))}
              </div>
            );
          })}

          {/* Ghost перетаскиваемого события — следует за курсором */}
          {ghost && (
            <div
              className={cn(
                'pointer-events-none absolute z-40 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] shadow-lg ring-2 ring-primary/40',
                STATUS_STYLE[ghost.status],
              )}
              style={{
                top: ghost.topPx,
                height: ghost.durationH * HOUR_PX,
                left: `calc(${GUTTER}px + ${ghost.dayIndex} * ((100% - ${GUTTER}px) / ${days.length}) + 4px)`,
                width: `calc((100% - ${GUTTER}px) / ${days.length} - 8px)`,
              }}
            >
              <div className="font-medium leading-tight">{pxToTimeLabel(ghost.topPx)}</div>
              <div className="truncate leading-tight">{ghost.title}</div>
            </div>
          )}

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
  slot,
  onOpen,
  onDragStart,
  dimmed,
}: {
  event: CalendarEvent;
  slot: Slot;
  onOpen: (e: CalendarEvent) => void;
  onDragStart?: (e: React.PointerEvent) => void;
  dimmed?: boolean;
}) {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 60 * 60_000);
  const top = (start.getHours() + start.getMinutes() / 60) * HOUR_PX;
  const durationH = Math.max(0.5, (end.getTime() - start.getTime()) / 3_600_000);
  const height = durationH * HOUR_PX;

  // Колонка дня делится между пересекающимися событиями. Слева отступ 4px,
  // справа — кликабельная полоса RIGHT_GUTTER, чтобы в занятый временной ряд
  // можно было кликнуть и добавить ещё одно событие. Между колонками — 2px.
  const GAP = 2;
  const EDGE = 4;
  const RIGHT_GUTTER = 24;
  const reserved = EDGE + RIGHT_GUTTER + (slot.cols - 1) * GAP;
  const colWidth = `((100% - ${reserved}px) / ${slot.cols})`;
  const left = `calc(${EDGE}px + ${slot.col} * (${colWidth} + ${GAP}px))`;
  const width = `calc(${colWidth})`;

  return (
    <button
      onPointerDown={onDragStart}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(event);
      }}
      className={cn(
        'absolute z-10 select-none overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] shadow-sm transition-shadow hover:shadow',
        STATUS_STYLE[event.status],
        onDragStart && 'cursor-grab active:cursor-grabbing',
        dimmed && 'opacity-40',
      )}
      style={{ top, height, left, width }}
    >
      <div className="font-medium leading-tight">{format(start, 'HH:mm')}</div>
      <div className="truncate leading-tight">{event.candidateName ?? event.title}</div>
    </button>
  );
}

export { HOUR_PX };
