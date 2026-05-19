import { Building2, Users } from 'lucide-react';
import type { Vacancy, User } from '@/api/types';
import { StackTags } from '@/components/common/StackTags';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { DaysBadge } from '@/components/common/DaysBadge';
import { AvatarStack } from '@/components/common/AvatarStack';

interface Props {
  vacancy: Vacancy;
  clientName?: string;
  recruiters: User[];
}

export function VacancyKanbanCard({ vacancy, clientName, recruiters }: Props) {
  return (
    <>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold leading-[17px] tracking-tight">{vacancy.title}</div>
        {(vacancy.priority === 'urgent' || vacancy.priority === 'high') && (
          <PriorityBadge priority={vacancy.priority} />
        )}
      </div>

      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Building2 className="h-3 w-3" strokeWidth={1.8} />
        <span className="font-medium">{clientName ?? '—'}</span>
        <span className="text-slate-300">·</span>
        <span>{vacancy.grade}</span>
      </div>

      <StackTags stack={vacancy.stack} max={3} className="mb-2.5" />

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
