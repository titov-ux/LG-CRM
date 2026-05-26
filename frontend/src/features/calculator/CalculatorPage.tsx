import { useMemo, useState } from 'react';
import { Calculator, Info, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatMoneyRub } from '@/lib/utils';
import {
  DEFAULT_HOURS_PER_MONTH,
  EMPLOYMENT_TAX_LABEL,
  EMPLOYMENT_TAX_RATE,
  TARGET_MARGIN_BY_EMPLOYMENT,
  monthlyClientRevenue,
  netToCandidate,
  round10k,
} from '@/lib/compensation';
import type { EmploymentType } from '@/api/types';

/**
 * Калькулятор «ставка заказчика → зарплата кандидата».
 *
 * Идея: рекрутёр на холодном звонке/в переписке быстро прикидывает,
 * какую максимальную зарплату мы можем предложить кандидату при заданной
 * почасовой ставке клиента и целевой марже. Для каждой формы оформления
 * (ТК РФ / ИП / СМЗ) показываем брутто-оклад «до» и «на руки» после налогов,
 * + сколько забирает агентство (маржа в ₽).
 *
 * Логика расчёта — общая с карточками вакансий, см. lib/compensation.ts.
 * Целевая маржа по умолчанию берётся из TARGET_MARGIN_BY_EMPLOYMENT,
 * но её можно переопределить на этой странице — изменения не сохраняются.
 */

const EMPLOYMENT_TYPES: EmploymentType[] = ['ТК РФ', 'ИП', 'СМЗ'];

const TYPE_ACCENT: Record<EmploymentType, string> = {
  'ТК РФ': 'border-l-4 border-l-amber-400',
  'ИП': 'border-l-4 border-l-emerald-400',
  'СМЗ': 'border-l-4 border-l-sky-400',
};

interface InputsState {
  rateClient: number;
  /** Целевая маржа в % (0..100) по каждой форме оформления, переопределяет дефолты. */
  margins: Record<EmploymentType, number>;
}

const DEFAULT_INPUTS: InputsState = {
  rateClient: 4000,
  margins: {
    'ТК РФ': Math.round(TARGET_MARGIN_BY_EMPLOYMENT['ТК РФ'] * 100),
    'ИП': Math.round(TARGET_MARGIN_BY_EMPLOYMENT['ИП'] * 100),
    'СМЗ': Math.round(TARGET_MARGIN_BY_EMPLOYMENT['СМЗ'] * 100),
  },
};

export function CalculatorPage() {
  const [inputs, setInputs] = useState<InputsState>(DEFAULT_INPUTS);

  // У нас всегда 160 часов в месяц — это стандарт для аутстаффа, отдельным полем
  // в форме не выводим, берём из общего lib/compensation.ts.
  const revenue = useMemo(
    () => monthlyClientRevenue(inputs.rateClient, DEFAULT_HOURS_PER_MONTH),
    [inputs.rateClient],
  );

  const rows = useMemo(
    () =>
      EMPLOYMENT_TYPES.map((type) => {
        const marginPct = clampPercent(inputs.margins[type]);
        const margin = marginPct / 100;
        const grossCap = Math.max(0, round10k(revenue * (1 - margin)));
        const net = netToCandidate(grossCap, type);
        const tax = Math.max(0, grossCap - net);
        const agencyMargin = Math.max(0, revenue - grossCap);
        return { type, marginPct, grossCap, net, tax, agencyMargin };
      }),
    [revenue, inputs.margins],
  );

  const reset = () => setInputs(DEFAULT_INPUTS);

  return (
    <div className="flex-1 space-y-4 overflow-auto px-6 pb-8 pt-5">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
            <Calculator className="h-4.5 w-4.5" strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">
              Калькулятор ставок
            </h1>
            <p className="text-[11.5px] text-muted-foreground">
              Введите почасовую ставку заказчика — увидите максимальную зарплату
              кандидату «до» и «на руки» по каждой форме оформления.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          className="text-[12px] text-muted-foreground"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Сбросить
        </Button>
      </div>

      {/* Параметры */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-[13px]">Параметры</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="max-w-sm space-y-1.5">
            <Label
              htmlFor="rateClient"
              className="text-[12px] font-medium text-muted-foreground"
            >
              Ставка заказчика, ₽/час
            </Label>
            <Input
              id="rateClient"
              type="number"
              inputMode="numeric"
              min={0}
              step={50}
              value={inputs.rateClient || ''}
              placeholder="0"
              onChange={(e) =>
                setInputs((s) => ({
                  ...s,
                  rateClient: numberFromInput(e.target.value),
                }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Цена часа, по которой выставляем заказчику. Месяц считаем как{' '}
              {DEFAULT_HOURS_PER_MONTH} часов.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Результаты по формам оформления */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.type} className={TYPE_ACCENT[row.type]}>
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[13px]">{row.type}</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help text-[11px] text-muted-foreground">
                      {EMPLOYMENT_TAX_LABEL[row.type]}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-[11.5px]">
                    {row.type === 'ТК РФ'
                      ? 'ТК РФ: −30% от брутто-выплаты (13% НДФЛ + страховые взносы). Обслуживание этой формы дороже, поэтому целевая маржа выше.'
                      : 'ИП/СМЗ: −6.5% (УСН 6% + ~1% сверх 300k округлённо). На «руки» получает значительно больше при той же брутто-выплате.'}
                  </TooltipContent>
                </Tooltip>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
              {/* Маржа — настраиваемая */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor={`margin-${row.type}`}
                    className="text-[11.5px] font-medium text-muted-foreground"
                  >
                    Целевая маржа
                  </Label>
                  <div className="flex items-center gap-1">
                    <Input
                      id={`margin-${row.type}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      value={inputs.margins[row.type]}
                      onChange={(e) =>
                        setInputs((s) => ({
                          ...s,
                          margins: {
                            ...s.margins,
                            [row.type]: numberFromInput(e.target.value),
                          },
                        }))
                      }
                      className="tnum h-7 w-16 text-right text-[12px]"
                    />
                    <span className="text-[12px] text-muted-foreground">%</span>
                  </div>
                </div>
                <p className="text-[10.5px] text-muted-foreground">
                  Маржа агентства: {formatMoneyRub(row.agencyMargin)} ₽/мес
                </p>
              </div>

              {/* Главное число — «на руки» */}
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    На руки кандидату
                  </span>
                  <InfoHint>
                    Брутто-оклад × (1 − {Math.round(EMPLOYMENT_TAX_RATE[row.type] * 100)}%),
                    округлено до 10 000 ₽.
                  </InfoHint>
                </div>
                <div className="tnum mt-1 text-[22px] font-semibold leading-none tracking-tight">
                  {formatMoneyRub(row.net)} ₽<span className="ml-1 text-[12px] font-normal text-muted-foreground">/мес</span>
                </div>
              </div>

              {/* Раскладка */}
              <dl className="space-y-1.5 text-[12px]">
                <Row
                  label="Зарплата «до» (брутто)"
                  value={`${formatMoneyRub(row.grossCap)} ₽`}
                  emphasize
                />
                <Row
                  label={`Налоги/взносы (${Math.round(EMPLOYMENT_TAX_RATE[row.type] * 100)}%)`}
                  value={`−${formatMoneyRub(row.tax)} ₽`}
                  muted
                />
                <Row
                  label="На руки"
                  value={`${formatMoneyRub(row.net)} ₽`}
                  emphasize
                />
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Подсказка снизу */}
      <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/20 p-3 text-[11.5px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          Расчёт идентичен карточкам вакансий: «Оклад до» = выручка × (1 − маржа),
          округлённая до 10 000 ₽; «На руки» = «Оклад до» − налоги по форме оформления.
          Целевая маржа по умолчанию: ТК РФ — 30%, ИП/СМЗ — 25% (обслуживание ТК РФ
          дороже из-за бухгалтерии, отпусков и рисков).
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt
        className={
          muted ? 'text-muted-foreground' : 'text-[12px] text-foreground/80'
        }
      >
        {label}
      </dt>
      <dd
        className={
          'tnum text-right ' +
          (emphasize
            ? 'font-semibold tabular-nums'
            : muted
              ? 'text-muted-foreground'
              : '')
        }
      >
        {value}
      </dd>
    </div>
  );
}

function InfoHint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Подсказка"
          className="text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] text-[11px]">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Парсинг ввода — пустая строка/некорректное число → 0. */
function numberFromInput(raw: string): number {
  const v = Number(raw.replace(',', '.'));
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

/** Маржа в % приводится к диапазону 0..99 (100% = ничего не платим, бессмысленно). */
function clampPercent(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 99) return 99;
  return pct;
}
