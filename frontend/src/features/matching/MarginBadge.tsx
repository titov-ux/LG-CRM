import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatMoneyRub } from '@/lib/utils';
import {
  calcMatchCompensation,
  marginZone,
  pairSupportsMargin,
  type MarginZone,
  type MatchCompensation,
} from '@/lib/compensation';
import type { Candidate, Vacancy } from '@/api/types';

/**
 * Компактный бейдж маржи для пары «вакансия ↔ кандидат».
 * При наведении показывает раскладку выручки, ставки и налогов.
 * Используется в карточке вакансии и в диалоге прикрепления.
 *
 * Защита от ошибочного применения: сам компонент проверяет тип сделки
 * через pairSupportsMargin и не отрисовывается, если хотя бы одна сторона —
 * агентство. Это страховка на случай, если внешний гейт забудут поставить.
 */

interface Props {
  vacancy: Pick<Vacancy, 'rateClient' | 'engagementType'>;
  candidate: Pick<Candidate, 'rateMonth' | 'employmentType' | 'engagementType'>;
  hoursPerMonth: number;
  /** 'sm' — для плотных списков (диалог), 'md' — для карточек. */
  size?: 'sm' | 'md';
}

const ZONE_BADGE: Record<MarginZone, string> = {
  loss: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  low: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  mid: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  high: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-[18px] min-w-[40px] px-1 text-[10.5px]',
  md: 'h-6 min-w-[44px] px-1.5 text-[11.5px]',
};

export function MarginBadge({ vacancy, candidate, hoursPerMonth, size = 'md' }: Props) {
  // Жёсткая страховка: маржа не имеет смысла, если хоть одна из сторон — агентская сделка.
  if (!pairSupportsMargin(vacancy, candidate)) return null;

  const comp = calcMatchCompensation({
    rateClient: vacancy.rateClient,
    rateMonth: candidate.rateMonth,
    employmentType: candidate.employmentType,
    hoursPerMonth,
  });
  // Порог «хорошей» маржи зависит от формы оформления:
  // ТК РФ — 30% (обслуживание дороже), ИП/СМЗ — 25%. См. marginZone.
  const zoneClass = ZONE_BADGE[marginZone(comp.marginPct, candidate.employmentType)];
  const sizeClass = SIZE_CLASS[size];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`tnum inline-flex cursor-default items-center justify-center rounded-md font-semibold ${sizeClass} ${zoneClass}`}
          aria-label={`Маржа ${comp.marginPct}%`}
        >
          {comp.marginPct > 0 ? '+' : ''}
          {comp.marginPct}%
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px]">
        <MarginTooltipContent
          comp={comp}
          rateClient={vacancy.rateClient}
          hoursPerMonth={hoursPerMonth}
          employmentType={candidate.employmentType}
        />
      </TooltipContent>
    </Tooltip>
  );
}

interface TooltipContentProps {
  comp: MatchCompensation;
  rateClient: number;
  hoursPerMonth: number;
  employmentType: Candidate['employmentType'];
}

function MarginTooltipContent({ comp, rateClient, hoursPerMonth, employmentType }: TooltipContentProps) {
  return (
    <div className="space-y-1.5">
      <div className="font-semibold">Расчёт маржи</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span className="text-muted-foreground">От клиента</span>
        <span className="tnum text-right">{formatMoneyRub(comp.clientRevenue)} ₽/мес</span>
        <span className="text-muted-foreground">Кандидату</span>
        <span className="tnum text-right">{formatMoneyRub(comp.candidateCost)} ₽/мес</span>
        <span className="text-muted-foreground">Маржа</span>
        <span className="tnum text-right">
          {formatMoneyRub(comp.marginAbs)} ₽ ({comp.marginPct}%)
        </span>
        <span className="text-muted-foreground">На руки</span>
        <span className="tnum text-right">{formatMoneyRub(comp.candidateNet)} ₽</span>
      </div>
      <div className="border-t pt-1 text-[10px] text-muted-foreground">
        {rateClient.toLocaleString('ru-RU')} ₽/ч × {hoursPerMonth} ч · {employmentType} {comp.taxLabel}
      </div>
    </div>
  );
}
