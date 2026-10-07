import { Building2, CalendarClock, Clock, Mail, Phone, UserRound } from 'lucide-react';
import type { Lead, User } from '@/api/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn } from '@/lib/utils';
import { daysUntil, formatCompactRub, parseISODate } from './utils';

interface Props {
  lead: Lead;
  accountManager?: User;
}

function formatShortDate(iso?: string | null): string {
  const d = parseISODate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

/** Бейдж следующего касания: просрочено — красный, сегодня/завтра — жёлтый. */
export function NextContactBadge({ iso }: { iso?: string | null }) {
  const days = daysUntil(iso);
  if (days === null) return null;

  const tone =
    days < 0
      ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
      : days <= 1
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-muted text-muted-foreground';

  const suffix =
    days < 0 ? 'просрочено' : days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days} дн`;

  return (
    <span
      className={cn(
        'tnum inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
        tone,
      )}
      title={`Следующий контакт: ${formatShortDate(iso)}`}
    >
      <CalendarClock className="h-2.5 w-2.5" strokeWidth={2} />
      {formatShortDate(iso)} · {suffix}
    </span>
  );
}

export function LeadKanbanCard({ lead, accountManager }: Props) {
  const showPriority = lead.priority === 'urgent' || lead.priority === 'high';
  const contactLine = [lead.contactName, lead.contactPosition].filter(Boolean).join(' · ');

  return (
    <>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {lead.source ? (
          <span className="inline-flex max-w-[70%] items-center rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            <span className="truncate">{lead.source}</span>
          </span>
        ) : (
          <span />
        )}
        {showPriority && (
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              lead.priority === 'urgent' ? 'bg-red-500' : 'bg-amber-500',
            )}
            title={lead.priority === 'urgent' ? 'Срочно' : 'Высокий приоритет'}
          />
        )}
      </div>

      <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold leading-[17px] tracking-tight">
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <span className="truncate">{lead.company || 'Компания не указана'}</span>
      </div>

      {lead.title && lead.title !== lead.company && (
        <div className="mb-2 line-clamp-2 text-[12px] leading-[16px] text-muted-foreground">
          {lead.title}
        </div>
      )}

      {(contactLine || lead.phone || lead.email) && (
        <div className="mb-2 space-y-0.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-[11.5px]">
          {contactLine && (
            <div className="flex items-center gap-1.5">
              <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={1.8} />
              <span className="truncate font-medium">{contactLine}</span>
            </div>
          )}
          {lead.phone && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" strokeWidth={1.8} />
              <span className="tnum truncate">{lead.phone}</span>
            </div>
          )}
          {lead.email && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" strokeWidth={1.8} />
              <span className="truncate">{lead.email}</span>
            </div>
          )}
        </div>
      )}

      {lead.expectedValue != null && lead.expectedValue > 0 && (
        <div className="mb-2">
          <div className="text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Потенциал
          </div>
          <div className="tnum text-[14px] font-semibold leading-tight">
            {formatCompactRub(lead.expectedValue)}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {lead.status !== 'won' && lead.status !== 'lost' && (
            <NextContactBadge iso={lead.nextContactDate} />
          )}
          <span className="tnum inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" strokeWidth={2} />
            {lead.daysInStatus}д
          </span>
        </div>
        {accountManager ? (
          <UserAvatar user={accountManager} size={22} interactive={false} />
        ) : (
          <span className="shrink-0 text-[10.5px] text-muted-foreground/60">без отв.</span>
        )}
      </div>
    </>
  );
}
