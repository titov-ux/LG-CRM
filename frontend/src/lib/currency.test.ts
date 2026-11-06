import { describe, expect, it } from 'vitest';
import { formatClientRate, formatMoney, toRub } from './currency';

const nb = (s: string) => s.replace(/ | /g, ' ');

describe('currency', () => {
  it('formats rubles and dollars', () => {
    expect(nb(formatMoney(4000, 'RUB'))).toBe('4 000 ₽');
    expect(nb(formatMoney(25, 'USD'))).toBe('25 $');
    expect(nb(formatMoney(25.5, 'USD'))).toBe('25,5 $');
    expect(nb(formatClientRate({ rateClient: 30, currency: 'USD' }))).toBe('30 $/час');
  });

  it('converts to rubles only when a USD rate is known', () => {
    expect(toRub(4000, 'RUB', null)).toBe(4000);
    expect(toRub(25, 'USD', 80)).toBe(2000);
    expect(toRub(25, 'USD', null)).toBeNull();
  });
});
