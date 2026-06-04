import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tendersApi, type TendersListParams } from '@/api/tenders';
import { auditApi } from '@/api/audit';
import type { Tender, TenderStatus, UUID } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const tenderKeys = {
  all: ['tenders'] as const,
  list: (params: TendersListParams) => [...tenderKeys.all, 'list', params] as const,
  byId: (id: UUID) => [...tenderKeys.all, 'byId', id] as const,
  activity: (id: UUID) => [...tenderKeys.all, 'activity', id] as const,
};

export function useTenders(params: TendersListParams = {}) {
  return useQuery({
    queryKey: tenderKeys.list(params),
    queryFn: () => tendersApi.list(params),
    ...QUERY_DEFAULTS,
  });
}

export function useTender(id: UUID | undefined) {
  return useQuery({
    queryKey: tenderKeys.byId(id ?? ''),
    queryFn: () => tendersApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useTenderActivity(id: UUID | undefined) {
  return useQuery({
    queryKey: tenderKeys.activity(id ?? ''),
    queryFn: () => auditApi.activity('tender', id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useCreateTender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Tender>) => tendersApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.all });
    },
  });
}

export function useUpdateTender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: Partial<Tender> }) =>
      tendersApi.update(id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(tenderKeys.byId(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: tenderKeys.all });
    },
  });
}

export function useDeleteTender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => tendersApi.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: tenderKeys.byId(id) });
      queryClient.invalidateQueries({ queryKey: tenderKeys.all });
    },
  });
}

export function useReorderTendersKanban() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: { id: UUID; status: TenderStatus; kanbanOrder: number }[]) =>
      tendersApi.reorderKanban(updates),
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: tenderKeys.all });
      const previous = queryClient.getQueriesData<{ items: Tender[] }>({ queryKey: tenderKeys.all });
      const updateMap = new Map(updates.map((u) => [u.id, u]));
      previous.forEach(([key, data]) => {
        if (!data?.items) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((t) => {
            const u = updateMap.get(t.id);
            if (!u) return t;
            const statusChanged = t.status !== u.status;
            return {
              ...t,
              status: u.status,
              kanbanOrder: u.kanbanOrder,
              daysInStatus: statusChanged ? 0 : t.daysInStatus,
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
      queryClient.invalidateQueries({ queryKey: tenderKeys.all });
    },
  });
}

export function useChangeTenderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, comment }: { id: UUID; status: TenderStatus; comment?: string }) =>
      tendersApi.changeStatus(id, status, comment),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: tenderKeys.all });
      const previous = queryClient.getQueriesData<{ items: Tender[] }>({ queryKey: tenderKeys.all });
      previous.forEach(([key, data]) => {
        if (!data?.items) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((t) => (t.id === id ? { ...t, status, daysInStatus: 0 } : t)),
        });
      });
      const byIdKey = tenderKeys.byId(id);
      const previousById = queryClient.getQueryData<Tender>(byIdKey);
      if (previousById) {
        queryClient.setQueryData(byIdKey, { ...previousById, status, daysInStatus: 0 });
      }
      return { previous, previousById, byIdKey };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(tenderKeys.byId(updated.id), updated);
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (ctx?.previousById !== undefined) {
        queryClient.setQueryData(ctx.byIdKey, ctx.previousById);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.all });
    },
  });
}
