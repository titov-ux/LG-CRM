import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vacanciesApi, type VacanciesListParams } from '@/api/vacancies';
import type { UUID, Vacancy, VacancyStatus } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const vacancyKeys = {
  all: ['vacancies'] as const,
  list: (params: VacanciesListParams) => [...vacancyKeys.all, 'list', params] as const,
  byId: (id: UUID) => [...vacancyKeys.all, 'byId', id] as const,
};

export function useVacancies(params: VacanciesListParams = {}) {
  return useQuery({
    queryKey: vacancyKeys.list(params),
    queryFn: () => vacanciesApi.list(params),
    ...QUERY_DEFAULTS,
  });
}

export function useVacancy(id: UUID | undefined) {
  return useQuery({
    queryKey: vacancyKeys.byId(id ?? ''),
    queryFn: () => vacanciesApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useCreateVacancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Vacancy>) => vacanciesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vacancyKeys.all });
    },
  });
}

export function useChangeVacancyStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, comment }: { id: UUID; status: VacancyStatus; comment?: string }) =>
      vacanciesApi.changeStatus(id, status, comment),
    // Оптимистичное обновление — карточка сразу переезжает в новую колонку.
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: vacancyKeys.all });
      const previous = queryClient.getQueriesData<{ items: Vacancy[] }>({ queryKey: vacancyKeys.all });
      previous.forEach(([key, data]) => {
        if (!data?.items) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((v) => (v.id === id ? { ...v, status, daysInStatus: 0 } : v)),
        });
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: vacancyKeys.all });
    },
  });
}
