import { Building2, Users } from 'lucide-react';
import type { Vacancy, User } from '@/api/types';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { DaysBadge } from '@/components/common/DaysBadge';
import { AvatarStack } from '@/components/common/AvatarStack';
import { EngagementBadge } from '@/components/common/EngagementBadge';
import { formatMoneyRub } from '@/lib/utils';

interface Props {
  vacancy: Vacancy;
  clientName?: string;
  recruiters: User[];
}

function vacancyPay(vacancy: Vacancy): string {
  if (vacancy.engagementType === 'agency') {
    return vacancy.salaryMax != null
      ? `до ${formatMoneyRub(vacancy.salaryMax)} ₽/мес`
      : 'оклад не указан';
  }
  return vacancy.rateClient > 0
    ? `${formatMoneyRub(vacancy.rateClient)} ₽/час`
    : 'ставка не указана';
}

export function VacancyKanbanCard({ vacancy, clientName, recruiters }: Props) {
  const hasPay =
    vacancy.engagementType === 'agency'
      ? vacancy.salaryMax != null
      : vacancy.rateClient > 0;

  return (
    <>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold leading-[17px] tracking-tight">{vacancy.title}</div>
        <div className="flex shrink-0 items-center gap-1">
          {(vacancy.priority === 'urgent' || vacancy.priority === 'high') && (
            <PriorityBadge priority={vacancy.priority} />
          )}
          <EngagementBadge type={vacancy.engagementType} />
        </div>
      </div>

      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Building2 className="h-3 w-3" strokeWidth={1.8} />
        <span className="font-medium">{clientName ?? '—'}</span>
        <span className="text-slate-300">·</span>
        <span>{vacancy.grade}</span>
      </div>

      <div
        className={
          'mb-2.5 tnum text-[13px] font-semibold ' +
          (hasPay ? 'text-foreground' : 'text-muted-foreground font-normal italic')
        }
      >
        {vacancyPay(vacancy)}
      </div>

      <div className="flex items-center justify-between border-t pt-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <DaysBadge days={vacancy.daysInStatus} />
          <span className="tnum inline-flex items-center gap-1">
            <Users className="h-3 w-3" strokeWidth={1.8} />
            {vacancy.candidatesCount}
          </span>
        </div>
        <AvatarStack users={recruiters} max={2} />
      </div>
    </>
  );
}
