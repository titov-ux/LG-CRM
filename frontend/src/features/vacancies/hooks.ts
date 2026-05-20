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

export function useUpdateVacancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: Partial<Vacancy> }) =>
      vacanciesApi.update(id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(vacancyKeys.byId(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: vacancyKeys.all });
    },
  });
}

export function useReorderVacanciesKanban() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: { id: UUID; status: VacancyStatus; kanbanOrder: number }[]) =>
      vacanciesApi.reorderKanban(updates),
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: vacancyKeys.all });
      const previous = queryClient.getQueriesData<{ items: Vacancy[] }>({ queryKey: vacancyKeys.all });
      const updateMap = new Map(updates.map((u) => [u.id, u]));
      previous.forEach(([key, data]) => {
        if (!data?.items) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((v) => {
            const u = updateMap.get(v.id);
            if (!u) return v;
            const statusChanged = v.status !== u.status;
            return {
              ...v,
              status: u.status,
              kanbanOrder: u.kanbanOrder,
              daysInStatus: statusChanged ? 0 : v.daysInStatus,
            };
          }),
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

export function useParseVacancyText() {
  return useMutation({
    mutationFn: (text: string) => vacanciesApi.parseText(text),
  });
}

export function useDeleteVacancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => vacanciesApi.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: vacancyKeys.byId(id) });
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
      const byIdKey = vacancyKeys.byId(id);
      const previousById = queryClient.getQueryData<Vacancy>(byIdKey);
      if (previousById) {
        queryClient.setQueryData(byIdKey, { ...previousById, status, daysInStatus: 0 });
      }
      return { previous, previousById, byIdKey };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(vacancyKeys.byId(updated.id), updated);
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (ctx?.previousById !== undefined) {
        queryClient.setQueryData(ctx.byIdKey, ctx.previousById);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: vacancyKeys.all });
    },
  });
}
