import { useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarClock, MapPin, Users, X, Check, Ban, Pencil, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CalendarEvent, EventStatus } from '@/api/types';
import { useCan } from '@/lib/permissions';
import { useCancelEvent, useDeleteEvent, useSetOutcome } from './hooks';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: CalendarEvent | null;
  onEdit: (event: CalendarEvent) => void;
}

const STATUS_STYLE: Record<EventStatus, { label: string; dot: string }> = {
  scheduled: { label: 'Запланировано', dot: 'bg-blue-500' },
  held: { label: 'Состоялось', dot: 'bg-emerald-500' },
  no_show: { label: 'Не пришёл', dot: 'bg-red-500' },
  canceled: { label: 'Отменено', dot: 'bg-muted-foreground' },
};

const LOCATION_LABEL = { online: 'Онлайн', onsite: 'В офисе', phone: 'Телефон' } as const;

export function EventDetailSheet({ open, onOpenChange, event, onEdit }: Props) {
  const canManage = useCan('event:set_outcome');
  const canDelete = useCan('event:delete');
  const setOutcome = useSetOutcome();
  const cancelEvent = useCancelEvent();
  const deleteEvent = useDeleteEvent();
  const [outcome, setOutcomeText] = useState('');

  if (!event) return null;

  const start = new Date(event.startsAt);
  const isOpen = event.status === 'scheduled';

  async function mark(status: 'held' | 'no_show') {
    try {
      await setOutcome.mutateAsync({ id: event!.id, payload: { status, outcome: outcome || undefined } });
      toast.success(status === 'held' ? 'Отмечено: состоялось' : 'Отмечено: не пришёл');
      onOpenChange(false);
    } catch {
      toast.error('Не удалось отметить исход');
    }
  }

  async function doCancel() {
    try {
      await cancelEvent.mutateAsync({ id: event!.id, reason: outcome || undefined });
      toast.success('Событие отменено');
      onOpenChange(false);
    } catch {
      toast.error('Не удалось отменить');
    }
  }

  async function doDelete() {
    try {
      await deleteEvent.mutateAsync(event!.id);
      toast.success('Событие удалено');
      onOpenChange(false);
    } catch {
      toast.error('Не удалось удалить');
    }
  }

  const busy = setOutcome.isPending || cancelEvent.isPending || deleteEvent.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <div className="flex flex-col gap-2 pr-8">
            <SheetTitle>{event.title}</SheetTitle>
            <span className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_STYLE[event.status].dot)} />
              {STATUS_STYLE[event.status].label}
            </span>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-4 py-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            <span>
              {format(start, 'd MMMM yyyy, HH:mm', { locale: ru })}
              {event.endsAt ? ` – ${format(new Date(event.endsAt), 'HH:mm', { locale: ru })}` : ''}
            </span>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="break-all">
              {LOCATION_LABEL[event.locationKind]}
              {event.location ? (
                <>
                  {' · '}
                  {/^https?:\/\//i.test(event.location) ? (
                    <a
                      href={event.location}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {event.location}
                    </a>
                  ) : (
                    event.location
                  )}
                </>
              ) : null}
            </span>
          </div>

          {(event.candidateName || event.vacancyTitle) && (
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              {event.candidateName && <div className="font-medium">{event.candidateName}</div>}
              {event.vacancyTitle && (
                <div className="text-muted-foreground">{event.vacancyTitle}</div>
              )}
            </div>
          )}

          {event.attendees.length > 0 && (
            <div className="flex items-start gap-2 text-muted-foreground">
              <Users className="mt-0.5 h-4 w-4" />
              <span>{event.attendees.map((a) => a.name ?? a.userId).join(', ')}</span>
            </div>
          )}

          {event.outcome && (
            <div className="rounded-md border-l-2 border-border bg-muted/20 px-3 py-2 text-muted-foreground">
              {event.outcome}
            </div>
          )}

          {isOpen && canManage && (
            <>
              <Separator />
              <div className="space-y-2">
                <Textarea
                  placeholder="Заметка по итогу (необязательно)"
                  value={outcome}
                  onChange={(e) => setOutcomeText(e.target.value)}
                  rows={3}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => mark('held')} disabled={busy}>
                    <Check className="mr-1.5 h-4 w-4" /> Состоялось
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => mark('no_show')} disabled={busy}>
                    <X className="mr-1.5 h-4 w-4" /> Не пришёл
                  </Button>
                  <Button size="sm" variant="outline" onClick={doCancel} disabled={busy}>
                    <Ban className="mr-1.5 h-4 w-4" /> Отменить
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          {canManage ? (
            <Button variant="ghost" size="sm" onClick={() => onEdit(event)} disabled={busy}>
              <Pencil className="mr-1.5 h-4 w-4" /> Изменить
            </Button>
          ) : (
            <span />
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={doDelete} disabled={busy} className="text-destructive">
              <Trash2 className="mr-1.5 h-4 w-4" /> Удалить
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
