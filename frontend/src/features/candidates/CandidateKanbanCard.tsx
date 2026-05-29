import { memo } from 'react';
import type { Candidate, User } from '@/api/types';
import { StackTags } from '@/components/common/StackTags';
import { DaysBadge } from '@/components/common/DaysBadge';
import { UserAvatar } from '@/components/common/UserAvatar';
import { EngagementBadge } from '@/components/common/EngagementBadge';
import { formatMoneyRub } from '@/lib/utils';

interface Props {
  candidate: Candidate;
  recruiter?: User;
}

// PERF: memo + сравнение по полям, которые реально рендерятся. Без этого при
// любой смене состояния доски (драг, optimistic-апдейт, WS-событие) карточки
// перерисовывались все разом. На 200 карточек это ≈ 60ms лишних рендеров.
export const CandidateKanbanCard = memo(_CandidateKanbanCardImpl, (prev, next) => {
  if (prev.recruiter?.id !== next.recruiter?.id) return false;
  const a = prev.candidate;
  const b = next.candidate;
  return (
    a.id === b.id &&
    a.fullName === b.fullName &&
    a.role === b.role &&
    a.grade === b.grade &&
    a.rateMonth === b.rateMonth &&
    a.daysInStatus === b.daysInStatus &&
    a.engagementType === b.engagementType &&
    a.stack === b.stack // ссылочное равенство — стек не мутируем
  );
});

function _CandidateKanbanCardImpl({ candidate, recruiter }: Props) {
  return (
    <>
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold leading-[17px] tracking-tight">{candidate.fullName}</div>
        <EngagementBadge type={candidate.engagementType} className="shrink-0" />
      </div>

      <div className="mb-2 text-[11.5px] text-muted-foreground">
        {candidate.role} <span className="text-slate-300">· </span>
        <span>{candidate.grade}</span>
      </div>

      <StackTags stack={candidate.stack} max={3} className="mb-2.5" />

      <div className="flex items-center justify-between border-t pt-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="tnum text-[13px] font-semibold text-foreground">{formatMoneyRub(candidate.rateMonth)} ₽</span>
          <DaysBadge days={candidate.daysInStatus} />
        </div>
        {recruiter && <UserAvatar user={recruiter} size={20} />}
      </div>
    </>
  );
}
