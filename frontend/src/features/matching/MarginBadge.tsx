import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatMoneyRub } from '@/lib/utils';
import {
  calcMatchCompensation,
  marginZone,
  pairSupportsMargin,
  type MarginZone,
  type MatchCompensation,
} from '@/lib/compensation';
import type { Candidate, Currency, Vacancy } from '@/api/types';
import { formatMoney, formatUsdRate, toRub } from '@/lib/currency';
import { useFxRates } from '@/features/fx/hooks';

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
  vacancy: Pick<Vacancy, 'rateClient' | 'engagementType'> & Partial<Pick<Vacancy, 'currency'>>;
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
  // Хук — до любых early return (rules of hooks).
  const fx = useFxRates().data;
  // Жёсткая страховка: маржа не имеет смысла, если хоть одна из сторон — агентская сделка.
  if (!pairSupportsMargin(vacancy, candidate)) return null;

  // Иностранный заказчик платит в $ — для маржи переводим ставку в ₽ по курсу ЦБ.
  const currency: Currency = vacancy.currency ?? 'RUB';
  const rateClientRub = toRub(vacancy.rateClient, currency, fx?.usdRub);
  if (rateClientRub == null) {
    return (
      <span
        className={`tnum inline-flex cursor-default items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground ${SIZE_CLASS[size]}`}
        title="Нет курса $ → ₽ — маржу посчитать нельзя"
      >
        $?
      </span>
    );
  }

  const comp = calcMatchCompensation({
    rateClient: rateClientRub,
    rateMonth: candidate.rateMonth,
    employmentType: candidate.employmentType,
    hoursPerMonth,
  });
  // Порог «хорошей» маржи зависит от формы оформления:
  // Целевая маржа 30% для всех форм; у ИП/СМЗ есть промежуточная зона 15–30%. См. marginZone.
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
          currency={currency}
          usdRub={fx?.usdRub ?? null}
          fxDate={fx?.date ?? null}
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
  currency: Currency;
  usdRub: number | null;
  fxDate: string | null;
  hoursPerMonth: number;
  employmentType: Candidate['employmentType'];
}

function MarginTooltipContent({
  comp,
  rateClient,
  currency,
  usdRub,
  fxDate,
  hoursPerMonth,
  employmentType,
}: TooltipContentProps) {
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
        {formatMoney(rateClient, currency)}/ч × {hoursPerMonth} ч · {employmentType} {comp.taxLabel}
        {currency === 'USD' && usdRub ? <div>{formatUsdRate(usdRub, fxDate)}</div> : null}
      </div>
    </div>
  );
}
