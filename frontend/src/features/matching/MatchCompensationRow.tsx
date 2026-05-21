import { ChevronRight, X } from 'lucide-react';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatMoneyRub } from '@/lib/utils';
import { calcMatchCompensation, pairSupportsMargin } from '@/lib/compensation';
import { MarginBadge } from './MarginBadge';
import type { Candidate, Vacancy } from '@/api/types';

interface Props {
  vacancy: Vacancy;
  candidate: Candidate;
  hoursPerMonth: number;
  onOpen: () => void;
  onDetach: () => void;
  detachDisabled?: boolean;
}

export function MatchCompensationRow({
  vacancy,
  candidate,
  hoursPerMonth,
  onOpen,
  onDetach,
  detachDisabled,
}: Props) {
  // В агентской модели маржа и «на руки» бессмысленны: LG получает разовый fee,
  // а не платит кандидату ежемесячно. Поэтому полный расчёт компенсации делаем
  // только для outstaff-пары, иначе показываем упрощённый ряд.
  const showMargin = pairSupportsMargin(vacancy, candidate);
  const comp = showMargin
    ? calcMatchCompensation({
        rateClient: vacancy.rateClient,
        rateMonth: candidate.rateMonth,
        employmentType: candidate.employmentType,
        hoursPerMonth,
      })
    : null;

  return (
    <div className="group flex items-center rounded-md border bg-muted/30 hover:bg-muted">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <UserAvatar
          user={{
            fullName: candidate.fullName,
            initials: candidate.fullName.split(' ').map((p) => p[0]).slice(0, 2).join(''),
            color: '#475569',
          }}
          size={26}
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{candidate.fullName}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {candidate.role} · {candidate.employmentType}
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2 pr-2">
        <div className="text-right">
          {/* Для outstaff показываем «на руки» (после налогов) — это конкретика, важная
              рекрутёру при разговоре с кандидатом. Для агентской пары comp нет
              (мы не платим кандидату ежемесячно), поэтому fallback — ожидаемый rateMonth. */}
          {comp ? (
            <div className="tnum text-[11.5px] leading-none text-muted-foreground">
              на руки {formatMoneyRub(comp.candidateNet)} ₽
            </div>
          ) : (
            <div className="tnum text-[11.5px] leading-none text-muted-foreground">
              {formatMoneyRub(candidate.rateMonth)} ₽/мес
            </div>
          )}
        </div>
        {showMargin && (
          <MarginBadge
            vacancy={vacancy}
            candidate={candidate}
            hoursPerMonth={hoursPerMonth}
            size="md"
          />
        )}

        <button
          type="button"
          onClick={onDetach}
          disabled={detachDisabled}
          aria-label={`Открепить ${candidate.fullName}`}
          title="Открепить от вакансии"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}
