import { Building2, CalendarClock, Clock, Hash, Landmark } from 'lucide-react';
import type { Tender, User } from '@/api/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn } from '@/lib/utils';
import { TENDER_LAW_META } from './statuses';

interface Props {
  tender: Tender;
  accountManager?: User;
}

/** Компактный формат суммы: 12,5 млн / 940 тыс / 4 500 ₽. */
function formatCompactRub(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m.toLocaleString('ru-RU', { maximumFractionDigits: m < 10 ? 1 : 0 })} млн ₽`;
  }
  if (value >= 100_000) {
    return `${Math.round(value / 1000).toLocaleString('ru-RU')} тыс ₽`;
  }
  return `${value.toLocaleString('ru-RU')} ₽`;
}

function parseISODate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysUntil(iso?: string | null): number | null {
  const target = parseISODate(iso);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatShortDate(iso?: string | null): string {
  const d = parseISODate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

/** Бейдж дедлайна подачи с цветовой логикой срочности. */
function DeadlineBadge({ iso }: { iso?: string | null }) {
  const days = daysUntil(iso);
  if (days === null) return null;

  const overdue = days < 0;
  const tone = overdue
    ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
    : days <= 3
      ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
      : days <= 7
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-muted text-muted-foreground';

  const suffix = overdue
    ? 'просрочено'
    : days === 0
      ? 'сегодня'
      : `${days} дн`;

  return (
    <span
      className={cn(
        'tnum inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
        tone,
      )}
      title={`Срок подачи: ${formatShortDate(iso)}`}
    >
      <CalendarClock className="h-2.5 w-2.5" strokeWidth={2} />
      {formatShortDate(iso)} · {suffix}
    </span>
  );
}

export function TenderKanbanCard({ tender, accountManager }: Props) {
  const law = TENDER_LAW_META[tender.law];
  const showPriority = tender.priority === 'urgent' || tender.priority === 'high';

  return (
    <>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold',
            law.badgeClassName,
          )}
        >
          <Landmark className="h-2.5 w-2.5" strokeWidth={2} />
          {law.label}
        </span>
        <div className="flex items-center gap-1.5">
          {showPriority && (
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                tender.priority === 'urgent' ? 'bg-red-500' : 'bg-amber-500',
              )}
              title={tender.priority === 'urgent' ? 'Срочно' : 'Высокий приоритет'}
            />
          )}
          {tender.registryNumber && (
            <span className="tnum inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground/80">
              <Hash className="h-2.5 w-2.5" strokeWidth={1.8} />
              {tender.registryNumber}
            </span>
          )}
        </div>
      </div>

      <div className="mb-1.5 line-clamp-2 text-[13px] font-semibold leading-[17px] tracking-tight">
        {tender.title}
      </div>

      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Building2 className="h-3 w-3 shrink-0" strokeWidth={1.8} />
        <span className="truncate font-medium">{tender.customer || 'Заказчик не указан'}</span>
      </div>

      <div className="mb-2.5 flex items-end justify-between gap-2">
        <div>
          <div className="text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
            НМЦК
          </div>
          <div
            className={cn(
              'tnum text-[15px] font-semibold leading-tight',
              tender.nmck > 0 ? 'text-foreground' : 'text-muted-foreground font-normal italic',
            )}
          >
            {tender.nmck > 0 ? formatCompactRub(tender.nmck) : 'не указана'}
          </div>
        </div>
        {tender.ourPrice != null && tender.ourPrice > 0 && (
          <div className="text-right">
            <div className="text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
              Наша цена
            </div>
            <div className="tnum text-[13px] font-semibold leading-tight text-emerald-600 dark:text-emerald-400">
              {formatCompactRub(tender.ourPrice)}
            </div>
          </div>
        )}
      </div>

      {tender.platform && (
        <div className="mb-2 inline-flex max-w-full items-center rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
          <span className="truncate">{tender.platform}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <div className="flex items-center gap-1.5">
          <DeadlineBadge iso={tender.submissionDeadline} />
          <span className="tnum inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" strokeWidth={2} />
            {tender.daysInStatus}д
          </span>
        </div>
        {accountManager ? (
          <UserAvatar user={accountManager} size={22} interactive={false} />
        ) : (
          <span className="text-[10.5px] text-muted-foreground/60">без отв.</span>
        )}
      </div>
    </>
  );
}
