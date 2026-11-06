import type { Currency, Vacancy } from '@/api/types';

/**
 * Валюта расчётов с клиентом.
 *
 * Иностранные заказчики платят в долларах: у клиента currency = 'USD', и
 * ставка всех его вакансий (Vacancy.rateClient) — в $/час. Себестоимость
 * кандидатов у нас всегда в рублях, поэтому для маржи долларовая ставка
 * переводится в ₽ по курсу ЦБ (useFxRates → /api/v1/fx/rates).
 */

export const CURRENCY_SIGN: Record<Currency, string> = {
  RUB: '₽',
  USD: '$',
};

export const CURRENCY_OPTIONS: { id: Currency; label: string }[] = [
  { id: 'RUB', label: '₽ — рубли (российский клиент)' },
  { id: 'USD', label: '$ — доллары (иностранный заказчик)' },
];

export function currencySign(currency: Currency | undefined | null): string {
  return CURRENCY_SIGN[currency ?? 'RUB'] ?? '₽';
}

/** «1 234 ₽» / «25 $». */
export function formatMoney(value: number, currency: Currency | undefined | null): string {
  const digits = currency === 'USD' && !Number.isInteger(value) ? 2 : 0;
  const text = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
  return `${text} ${currencySign(currency)}`;
}

/** Ставка клиента для подписи: «4 000 ₽/час» / «25 $/час». */
export function formatClientRate(
  vacancy: Pick<Vacancy, 'rateClient' | 'currency'>,
  unit = 'час',
): string {
  return `${formatMoney(vacancy.rateClient, vacancy.currency)}/${unit}`;
}

/**
 * Сумма в рублях. Для USD — по курсу; если курса нет — null
 * (маржу по такой вакансии посчитать нельзя).
 */
export function toRub(
  amount: number,
  currency: Currency | undefined | null,
  usdRub: number | null | undefined,
): number | null {
  if (!currency || currency === 'RUB') return amount;
  if (currency === 'USD' && usdRub && usdRub > 0) return amount * usdRub;
  return null;
}

/** Курс для подсказок: «$1 = 81,25 ₽ (ЦБ на 06.11.2026)». */
export function formatUsdRate(usdRub: number, date?: string | null): string {
  const rate = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(usdRub);
  const when = date ? ` на ${date.split('-').reverse().join('.')}` : '';
  return `$1 = ${rate} ₽ (ЦБ${when})`;
}
