import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CalendarEvent, EventLocationKind, UUID } from '@/api/types';
import { useCreateEvent, useUpdateEvent } from './hooks';
import { useCandidatesList, useUsersList, useVacanciesList } from './pickers';

export interface EventFormPrefill {
  candidateId?: UUID;
  vacancyId?: UUID;
  matchId?: UUID;
  startsAt?: Date;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Если задан — режим редактирования. */
  event?: CalendarEvent | null;
  prefill?: EventFormPrefill;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Date → "HH:mm" для <input type="time"> в локальном времени. */
function toTimeInput(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Совместить день (Date) и время "HH:mm" в один Date. */
function combine(day: Date, time: string): Date {
  const [h, m] = time.split(':').map((x) => parseInt(x, 10));
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

const LOCATION_LABELS: Record<EventLocationKind, string> = {
  online: 'Онлайн',
  onsite: 'В офисе',
  phone: 'Телефон',
};

export function EventFormSheet({ open, onOpenChange, event, prefill }: Props) {
  const isEdit = !!event;
  const create = useCreateEvent();
  const update = useUpdateEvent();
  // Справочники грузим только когда форма реально открыта — иначе тяжёлый
  // запрос 500 кандидатов + вакансии блокировал первый рендер страницы.
  const { data: users = [] } = useUsersList(open);
  const { data: candidates = [] } = useCandidatesList(open);
  const { data: vacancies = [] } = useVacanciesList(open);

  const [title, setTitle] = useState('');
  const [candidateId, setCandidateId] = useState<UUID | ''>('');
  const [vacancyId, setVacancyId] = useState<UUID | ''>('');
  // День события определяется контекстом (клик по дате на сетке или
  // редактируемое событие); в форме пользователь выбирает только время.
  const [eventDate, setEventDate] = useState<Date>(() => new Date());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [locationKind, setLocationKind] = useState<EventLocationKind>('online');
  const [location, setLocation] = useState('');
  const [attendeeIds, setAttendeeIds] = useState<UUID[]>([]);

  // Заполняем форму при открытии (edit → из события, create → из prefill).
  useEffect(() => {
    if (!open) return;
    if (event) {
      const start = new Date(event.startsAt);
      setTitle(event.title);
      setCandidateId(event.candidateId ?? '');
      setVacancyId(event.vacancyId ?? '');
      setEventDate(start);
      setStartTime(toTimeInput(start));
      setEndTime(event.endsAt ? toTimeInput(new Date(event.endsAt)) : '');
      setLocationKind(event.locationKind);
      setLocation(event.location ?? '');
      setAttendeeIds(event.attendees.map((a) => a.userId));
    } else {
      const base = prefill?.startsAt ?? defaultStart();
      setTitle('');
      setCandidateId(prefill?.candidateId ?? '');
      setVacancyId(prefill?.vacancyId ?? '');
      setEventDate(base);
      setStartTime(toTimeInput(base));
      // Собес по умолчанию длится 1 час → окончание = старт + 60 мин.
      setEndTime(toTimeInput(new Date(base.getTime() + 60 * 60_000)));
      setLocationKind('online');
      setLocation('');
      setAttendeeIds([]);
    }
  }, [open, event, prefill]);

  const busy = create.isPending || update.isPending;

  const matchId = prefill?.matchId ?? event?.matchId ?? undefined;

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? '')),
    [users],
  );

  function toggleAttendee(id: UUID) {
    setAttendeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    if (!startTime) {
      toast.error('Укажите время начала');
      return;
    }
    const startIso = combine(eventDate, startTime).toISOString();
    const endIso = endTime ? combine(eventDate, endTime).toISOString() : null;
    try {
      if (isEdit && event) {
        await update.mutateAsync({
          id: event.id,
          payload: {
            title: title || undefined,
            startsAt: startIso,
            endsAt: endIso,
            locationKind,
            location: location || null,
            attendeeIds,
          },
        });
        toast.success('Событие обновлено');
      } else {
        await create.mutateAsync({
          type: 'interview',
          title: title || undefined,
          startsAt: startIso,
          endsAt: endIso,
          locationKind,
          location: location || null,
          candidateId: candidateId || null,
          vacancyId: vacancyId || null,
          matchId: matchId ?? null,
          attendeeIds,
        });
        toast.success('Собеседование назначено');
      }
      onOpenChange(false);
    } catch {
      toast.error('Не удалось сохранить событие');
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Редактировать событие' : 'Назначить собеседование'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Измените время, место или участников.'
              : 'Выберите кандидата, время и участников собеседования.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1">
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="ev-title">Название</Label>
              <Input
                id="ev-title"
                value={title}
                placeholder="Авто: «Собес: ФИО — Вакансия»"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {!isEdit && (
              <>
                <div className="space-y-1.5">
                  <Label>Кандидат</Label>
                  <Select value={candidateId} onValueChange={(v) => setCandidateId(v as UUID)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите кандидата" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Вакансия</Label>
                  <Select value={vacancyId} onValueChange={(v) => setVacancyId(v as UUID)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Без вакансии" />
                    </SelectTrigger>
                    <SelectContent>
                      {vacancies.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label>Дата</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm capitalize text-muted-foreground">
                {format(eventDate, 'EEEE, d MMMM yyyy', { locale: ru })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ev-start">Начало</Label>
                <Input
                  id="ev-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-end">Окончание</Label>
                <Input
                  id="ev-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Формат</Label>
                <Select
                  value={locationKind}
                  onValueChange={(v) => setLocationKind(v as EventLocationKind)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['online', 'onsite', 'phone'] as EventLocationKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {LOCATION_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-loc">
                  {locationKind === 'online' ? 'Ссылка' : 'Адрес / телефон'}
                </Label>
                <Input
                  id="ev-loc"
                  value={location}
                  placeholder={locationKind === 'online' ? 'https://…' : ''}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Участники</Label>
              <div className="max-h-44 space-y-1 overflow-auto rounded-md border p-2">
                {sortedUsers.length === 0 && (
                  <p className="px-1 py-2 text-sm text-muted-foreground">Нет пользователей</p>
                )}
                {sortedUsers.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={attendeeIds.includes(u.id)}
                      onCheckedChange={() => toggleAttendee(u.id)}
                    />
                    <span>{u.fullName}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={busy}>
            {isEdit ? 'Сохранить' : 'Назначить'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function defaultStart(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}
