import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leadsApi, type LeadsListParams } from '@/api/leads';
import { auditApi } from '@/api/audit';
import type { Lead, LeadStatus, UUID } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const leadKeys = {
  all: ['leads'] as const,
  list: (params: LeadsListParams) => [...leadKeys.all, 'list', params] as const,
  byId: (id: UUID) => [...leadKeys.all, 'byId', id] as const,
  activity: (id: UUID) => [...leadKeys.all, 'activity', id] as const,
};

export function useLeads(params: LeadsListParams = {}) {
  return useQuery({
    queryKey: leadKeys.list(params),
    queryFn: () => leadsApi.list(params),
    ...QUERY_DEFAULTS,
  });
}

export function useLead(id: UUID | undefined) {
  return useQuery({
    queryKey: leadKeys.byId(id ?? ''),
    queryFn: () => leadsApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useLeadActivity(id: UUID | undefined) {
  return useQuery({
    queryKey: leadKeys.activity(id ?? ''),
    queryFn: () => auditApi.activity('lead', id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Lead>) => leadsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: Partial<Lead> }) =>
      leadsApi.update(id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(leadKeys.byId(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => leadsApi.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: leadKeys.byId(id) });
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useReorderLeadsKanban() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: { id: UUID; status: LeadStatus; kanbanOrder: number }[]) =>
      leadsApi.reorderKanban(updates),
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: leadKeys.all });
      const previous = queryClient.getQueriesData<{ items: Lead[] }>({ queryKey: leadKeys.all });
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
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useChangeLeadStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, comment }: { id: UUID; status: LeadStatus; comment?: string }) =>
      leadsApi.changeStatus(id, status, comment),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: leadKeys.all });
      const previous = queryClient.getQueriesData<{ items: Lead[] }>({ queryKey: leadKeys.all });
      previous.forEach(([key, data]) => {
        if (!data?.items) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((t) => (t.id === id ? { ...t, status, daysInStatus: 0 } : t)),
        });
      });
      const byIdKey = leadKeys.byId(id);
      const previousById = queryClient.getQueryData<Lead>(byIdKey);
      if (previousById) {
        queryClient.setQueryData(byIdKey, { ...previousById, status, daysInStatus: 0 });
      }
      return { previous, previousById, byIdKey };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(leadKeys.byId(updated.id), updated);
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (ctx?.previousById !== undefined) {
        queryClient.setQueryData(ctx.byIdKey, ctx.previousById);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}
