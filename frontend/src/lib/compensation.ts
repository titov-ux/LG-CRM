import type { Candidate, EmploymentType, EngagementType, Vacancy } from '@/api/types';

/**
 * Логика расчёта маржи и нетто-выплат кандидату.
 * Перенесена из исходного калькулятора rate.html и адаптирована под модель CRM-ЛГ.
 *
 * Допущения, согласованные с продактом:
 *   • Vacancy.rateClient — почасовая ставка от клиента (₽/час).
 *   • Месячная выручка от клиента = rateClient × часы_в_месяц (по умолчанию 160).
 *   • Candidate.rateMonth — то, что мы платим кандидату в месяц (брутто его «оформления»).
 *   • НПД/УСН/НДФЛ удерживаются ИЗ rateMonth — это «на руки» кандидата.
 *   • Маржа = (выручка_от_клиента − rateMonth) / выручка_от_клиента.
 *
 * Налоговые ставки:
 *   • ТК РФ — −30% (НДФЛ + страховые взносы)
 *   • ИП    — −6.5% (УСН 6% + 1% сверх 300k округлённо)
 *   • СМЗ   — считаем как ИП (по согласованию)
 */

export const DEFAULT_HOURS_PER_MONTH = 160;

/**
 * Целевая маржа по умолчанию для расчёта «потолка оклада» по вакансии.
 * Соответствует границе «высокой» зоны в marginZone — то есть «оклад до»,
 * который мы готовы предложить кандидату, не проваливая маржу ниже хорошей.
 */
export const TARGET_MARGIN = 0.25;

/**
 * Целевая маржа по форме оформления. У ТК РФ выше, потому что эта форма
 * дороже в обслуживании (бухгалтерия, отпуска, больничные, риски),
 * и при той же выручке от клиента мы можем отдать кандидату меньше.
 */
export const TARGET_MARGIN_BY_EMPLOYMENT: Record<EmploymentType, number> = {
  'ТК РФ': 0.30,
  'ИП': 0.25,
  'СМЗ': 0.25,
};

/** Доля удержаний из выплаты кандидату по типу оформления. */
export const EMPLOYMENT_TAX_RATE: Record<EmploymentType, number> = {
  'ТК РФ': 0.30,
  'ИП': 0.065,
  'СМЗ': 0.065,
};

/** Подпись налога — для подсказок в UI. */
export const EMPLOYMENT_TAX_LABEL: Record<EmploymentType, string> = {
  'ТК РФ': '−30% (НДФЛ + взносы)',
  'ИП': '−6.5% УСН',
  'СМЗ': '−6.5% (как ИП)',
};

/** Округление до ближайших 10 000 ₽ — как в исходном калькуляторе. */
export function round10k(n: number): number {
  return Math.round(n / 10000) * 10000;
}

/** Месячная выручка от клиента: rateClient (₽/час) × часы в месяц. */
export function monthlyClientRevenue(rateClient: number, hoursPerMonth = DEFAULT_HOURS_PER_MONTH): number {
  return Math.max(0, rateClient) * Math.max(0, hoursPerMonth);
}

/**
 * Чистая выплата кандидату «на руки» в месяц после налогов.
 * round10k повторяет поведение исходного rate.html.
 */
export function netToCandidate(rateMonth: number, employmentType: EmploymentType): number {
  const rate = EMPLOYMENT_TAX_RATE[employmentType] ?? 0;
  return round10k(rateMonth - rateMonth * rate);
}

/**
 * Маржа в долях (0..1). Если выручка ≤ 0 — возвращаем 0.
 * Может быть отрицательной, если ставка кандидата выше выручки от клиента —
 * это сигнал «убыточный мэтч».
 */
export function marginShare(clientRevenue: number, rateMonth: number): number {
  if (clientRevenue <= 0) return 0;
  return (clientRevenue - rateMonth) / clientRevenue;
}

/** Маржа в процентах, округлённая до целых. */
export function marginPercent(clientRevenue: number, rateMonth: number): number {
  return Math.round(marginShare(clientRevenue, rateMonth) * 100);
}

export interface MatchCompensation {
  /** Месячная выручка от клиента, ₽. */
  clientRevenue: number;
  /** Месячная себестоимость = rateMonth кандидата, ₽. */
  candidateCost: number;
  /** Маржа в процентах (может быть отрицательной). */
  marginPct: number;
  /** Маржа в рублях. */
  marginAbs: number;
  /** «На руки» кандидату в месяц после налогов, ₽. */
  candidateNet: number;
  /** Удержания (НДФЛ/УСН/НПД) в рублях. */
  candidateTax: number;
  /** Текстовая подпись налога. */
  taxLabel: string;
}

/** Полный расчёт компенсации для пары «вакансия ↔ кандидат». */
export function calcMatchCompensation(params: {
  rateClient: number;
  rateMonth: number;
  employmentType: EmploymentType;
  hoursPerMonth?: number;
}): MatchCompensation {
  const hours = params.hoursPerMonth ?? DEFAULT_HOURS_PER_MONTH;
  const clientRevenue = monthlyClientRevenue(params.rateClient, hours);
  const candidateCost = Math.max(0, params.rateMonth);
  const candidateNet = netToCandidate(candidateCost, params.employmentType);
  const candidateTax = Math.max(0, candidateCost - candidateNet);
  return {
    clientRevenue,
    candidateCost,
    marginPct: marginPercent(clientRevenue, candidateCost),
    marginAbs: clientRevenue - candidateCost,
    candidateNet,
    candidateTax,
    taxLabel: EMPLOYMENT_TAX_LABEL[params.employmentType] ?? '',
  };
}

/**
 * Цветовая зона маржи — для бейджей.
 * Пороги для ИП/СМЗ: <15% — низкая, 15–25% — средняя, ≥25% — высокая.
 * Для ТК РФ обслуживание дороже (бухгалтерия, отпуска, риски), поэтому
 * «хорошая» зона начинается с 30%, ниже — сразу жёлтая зона без «mid».
 * Отрицательная маржа = убыток (red) для любой формы оформления.
 */
export type MarginZone = 'loss' | 'low' | 'mid' | 'high';

export function marginZone(pct: number, employmentType?: EmploymentType): MarginZone {
  if (pct < 0) return 'loss';
  if (employmentType === 'ТК РФ') {
    // Для ТК РФ: ниже целевой 30% — жёлтая, иначе зелёная. Промежуточной «mid» нет.
    return pct < 30 ? 'low' : 'high';
  }
  if (pct < 15) return 'low';
  if (pct < 25) return 'mid';
  return 'high';
}

/**
 * «Потолок оклада» по вакансии для конкретной формы оформления —
 * сколько кандидат получит «на руки» в месяц, если мы отдадим ему всё, что
 * остаётся от выручки клиента после удержания целевой маржи.
 *
 * Формула:
 *   revenue        = rateClient × hoursPerMonth
 *   rateMonthCap   = revenue × (1 − targetMargin)            // потолок брутто-выплаты
 *   net на руки    = round10k(rateMonthCap × (1 − налог))    // как в netToCandidate
 *
 * При rateClient ≤ 0 возвращает 0.
 */
export function vacancyMaxNetSalary(params: {
  rateClient: number;
  employmentType: EmploymentType;
  hoursPerMonth?: number;
  targetMargin?: number;
}): number {
  const hours = params.hoursPerMonth ?? DEFAULT_HOURS_PER_MONTH;
  const target =
    params.targetMargin ?? TARGET_MARGIN_BY_EMPLOYMENT[params.employmentType] ?? TARGET_MARGIN;
  const revenue = monthlyClientRevenue(params.rateClient, hours);
  const rateMonthCap = Math.max(0, revenue * (1 - target));
  return netToCandidate(rateMonthCap, params.employmentType);
}

/**
 * Маржа имеет смысл только в outstaff-модели:
 *   • вакансия с почасовой ставкой клиента,
 *   • кандидат, которому мы платим ежемесячно.
 *
 * В агентской модели LG берёт разовый fee за подбор, а ежемесячной маржи нет —
 * соответственно MarginBadge / MatchCompensationRow в их полном виде там не нужны.
 */
export function supportsMargin(
  vacancyType: EngagementType,
  candidateType: EngagementType,
): boolean {
  return vacancyType === 'outstaff' && candidateType === 'outstaff';
}

/** Удобная перегрузка для случаев, когда есть полные объекты. */
export function pairSupportsMargin(
  vacancy: Pick<Vacancy, 'engagementType'>,
  candidate: Pick<Candidate, 'engagementType'>,
): boolean {
  return supportsMargin(vacancy.engagementType, candidate.engagementType);
}

/**
 * Превышает ли ожидаемый оклад кандидата «Оклад до» по агентской вакансии.
 *
 * Логика применима только к engagementType === 'agency' и только если у вакансии
 * указан salaryMax. Для аутстаффа верхней границы оклада нет — там сравнивать не с чем.
 * Если salaryMax не задан (null / undefined) — считаем, что ограничения нет.
 */
export function candidateSalaryExceedsVacancyMax(
  vacancy: Pick<Vacancy, 'engagementType' | 'salaryMax'>,
  candidate: Pick<Candidate, 'rateMonth'>,
): boolean {
  if (vacancy.engagementType !== 'agency') return false;
  if (vacancy.salaryMax == null) return false;
  return candidate.rateMonth > vacancy.salaryMax;
}
