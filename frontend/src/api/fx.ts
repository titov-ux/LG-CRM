import { api } from './client';

export interface FxRates {
  /** Курс ЦБ: сколько рублей за $1. null — курс сейчас недоступен. */
  usdRub: number | null;
  /** Дата курса (YYYY-MM-DD). */
  date: string | null;
  source: 'cbr' | 'cbr_cached' | 'fallback' | null;
}

export const fxApi = {
  rates: () => api.get('fx/rates').json<FxRates>(),
};
