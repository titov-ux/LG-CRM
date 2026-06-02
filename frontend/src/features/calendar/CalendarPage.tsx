import { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useCan } from '@/lib/permissions';
import type { CalendarEvent, EventStatus, UUID } from '@/api/types';
import { useCalendarEvents, useUpdateEvent } from './hooks';
import { useUsersList } from './pickers';
import { EventFormSheet, type EventFormPrefill } from './EventFormSheet';
import { EventDetailSheet } from './EventDetailSheet';
import { MiniCalendar } from './MiniCalendar';
import { MonthGrid } from './MonthGrid';
import { TimeGrid } from './TimeGrid';

type ViewMode = 'day' | 'week' | 'month';

const VIEW_LABEL: Record<ViewMode, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
};

export function CalendarPage() {
  const canCreate = useCan('event:create');
  const canEdit = useCan('event:edit');
  const updateEvent = useUpdateEvent();
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [recruiterId, setRecruiterId] = useState<UUID | 'all'>('all');
  const [status, setStatus] = useState<EventStatus | 'all'>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [prefill, setPrefill] = useState<EventFormPrefill | undefined>();

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);

  const { data: users = [] } = useUsersList();

  // Диапазон выборки и набор колонок зависят от режима.
  const { rangeFrom, rangeTo, columns } = useMemo(() => {
    if (view === 'day') {
      const start = new Date(anchor);
      start.setHours(0, 0, 0, 0);
      return { rangeFrom: start, rangeTo: addDays(start, 1), columns: [start] };
    }
    if (view === 'week') {
      const start = startOfWeek(anchor, { weekStartsOn: 1 });
      const cols = eachDayOfInterval({ start, end: addDays(start, 6) });
      return { rangeFrom: start, rangeTo: addDays(start, 7), columns: cols };
    }
    // month
    const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
    return { rangeFrom: gridStart, rangeTo: addDays(gridEnd, 1), columns: [] };
  }, [view, anchor]);

  const { data: events = [], isLoading } = useCalendarEvents({
    from: rangeFrom.toISOString(),
    to: rangeTo.toISOString(),
    recruiterId: recruiterId === 'all' ? undefined : recruiterId,
    status: status === 'all' ? undefined : status,
  });

  // Заголовок слева — «Месяц Год» по активному периоду (как в Яндекс.Календаре).
  const titleLabel = useMemo(() => {
    const ref = view === 'week' ? startOfWeek(anchor, { weekStartsOn: 1 }) : anchor;
    return format(ref, 'LLLL yyyy', { locale: ru });
  }, [view, anchor]);

  function step(dir: 1 | -1) {
    if (view === 'day') setAnchor(addDays(anchor, dir));
    else if (view === 'week') setAnchor(addDays(anchor, dir * 7));
    else setAnchor(addMonths(anchor, dir));
  }

  function openCreate(date?: Date) {
    setEditEvent(null);
    setPrefill(date ? { startsAt: date } : undefined);
    setFormOpen(true);
  }

  function openEvent(ev: CalendarEvent) {
    setSelected(ev);
    setDetailOpen(true);
  }

  function startEdit(ev: CalendarEvent) {
    setDetailOpen(false);
    setEditEvent(ev);
    setPrefill(undefined);
    setFormOpen(true);
  }

  // Перенос события перетаскиванием: сохраняем длительность, шлём новые startsAt/endsAt.
  function moveEvent(ev: CalendarEvent, newStart: Date) {
    const oldStart = new Date(ev.startsAt).getTime();
    const durationMs = ev.endsAt ? new Date(ev.endsAt).getTime() - oldStart : 60 * 60_000;
    const newEnd = new Date(newStart.getTime() + durationMs);
    updateEvent.mutate(
      {
        id: ev.id,
        payload: { startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() },
      },
      {
        onSuccess: () => toast.success('Событие перенесено'),
        onError: () => toast.error('Не удалось перенести событие'),
      },
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Левая панель (как в Яндекс.Календаре) */}
      <aside className="hidden w-60 shrink-0 flex-col gap-4 border-r p-4 lg:flex">
        {canCreate && (
          <Button className="w-full justify-start" onClick={() => openCreate()}>
            <Plus className="mr-1.5 h-4 w-4" /> Создать
          </Button>
        )}
        <MiniCalendar
          selected={anchor}
          onSelect={(d) => {
            setAnchor(d);
            if (view === 'month') setView('day');
          }}
        />
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Фильтры
          </div>
          <Select value={recruiterId} onValueChange={(v) => setRecruiterId(v as UUID | 'all')}>
            <SelectTrigger className="h-8 w-full text-sm">
              <SelectValue placeholder="Участник" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все участники</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as EventStatus | 'all')}>
            <SelectTrigger className="h-8 w-full text-sm">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="scheduled">Запланировано</SelectItem>
              <SelectItem value="held">Состоялось</SelectItem>
              <SelectItem value="no_show">Не пришёл</SelectItem>
              <SelectItem value="canceled">Отменено</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </aside>

      {/* Основная область */}
      <div className="flex flex-1 flex-col gap-3 overflow-hidden py-4">
        {/* Тулбар: слева «Месяц Год», справа навигация + вид (как в Яндексе).
            Горизонтальные отступы — только у тулбара; сетка остаётся во всю ширину. */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4">
          <h2 className="text-xl font-semibold capitalize tracking-tight">
            {titleLabel}
          </h2>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>
              Сегодня
            </Button>
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => step(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => step(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  {VIEW_LABEL[view]}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(['day', 'week', 'month'] as ViewMode[]).map((m) => (
                  <DropdownMenuItem key={m} onClick={() => setView(m)}>
                    {VIEW_LABEL[m]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Сетка */}
        {isLoading ? (
          <Skeleton className="flex-1" />
        ) : view === 'month' ? (
          <MonthGrid
            anchor={anchor}
            events={events}
            onOpenEvent={openEvent}
            onCreateAt={(d) => canCreate && openCreate(atDefaultTime(d))}
          />
        ) : (
          <TimeGrid
            days={columns}
            events={events}
            onOpenEvent={openEvent}
            onCreateAt={(d) => canCreate && openCreate(d)}
            onMoveEvent={canEdit ? moveEvent : undefined}
          />
        )}
      </div>

      <EventFormSheet open={formOpen} onOpenChange={setFormOpen} event={editEvent} prefill={prefill} />
      <EventDetailSheet open={detailOpen} onOpenChange={setDetailOpen} event={selected} onEdit={startEdit} />
    </div>
  );
}

function atDefaultTime(date: Date): Date {
  const d = new Date(date);
  d.setHours(10, 0, 0, 0);
  return d;
}
