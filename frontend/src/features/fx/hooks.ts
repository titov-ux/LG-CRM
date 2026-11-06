import { useQuery } from '@tanstack/react-query';
import { fxApi } from '@/api/fx';

/** Курс USD→RUB (ЦБ). Курс меняется раз в день — держим час без перезапросов. */
export function useFxRates() {
  return useQuery({
    queryKey: ['fx', 'rates'] as const,
    queryFn: () => fxApi.rates(),
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    retry: 1,
  });
}

/** Только курс $→₽ (или null, пока не загружен / недоступен). */
export function useUsdRub(): number | null {
  return useFxRates().data?.usdRub ?? null;
}
