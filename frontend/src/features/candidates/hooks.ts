import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { candidatesApi, type CandidatesListParams } from '@/api/candidates';
import { auditApi } from '@/api/audit';
import type { Candidate, CandidateStatus, UUID } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const candidateKeys = {
  all: ['candidates'] as const,
  list: (params: CandidatesListParams) => [...candidateKeys.all, 'list', params] as const,
  byId: (id: UUID) => [...candidateKeys.all, 'byId', id] as const,
  activity: (id: UUID) => [...candidateKeys.all, 'activity', id] as const,
};

export function useCandidates(params: CandidatesListParams = {}) {
  return useQuery({
    queryKey: candidateKeys.list(params),
    queryFn: () => candidatesApi.list(params),
    ...QUERY_DEFAULTS,
  });
}

export function useCandidate(id: UUID | undefined) {
  return useQuery({
    queryKey: candidateKeys.byId(id ?? ''),
    queryFn: () => candidatesApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useCandidateActivity(id: UUID | undefined) {
  return useQuery({
    queryKey: candidateKeys.activity(id ?? ''),
    queryFn: () => auditApi.activity('candidate', id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useCreateCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Candidate>) => candidatesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: candidateKeys.all });
    },
  });
}

export function useChangeCandidateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, comment }: { id: UUID; status: CandidateStatus; comment?: string }) =>
      candidatesApi.changeStatus(id, status, comment),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: candidateKeys.all });
      const previous = queryClient.getQueriesData<{ items: Candidate[] }>({ queryKey: candidateKeys.all });
      previous.forEach(([key, data]) => {
        if (!data?.items) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((c) => (c.id === id ? { ...c, status, daysInStatus: 0 } : c)),
        });
      });
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous.forEach(([k, d]) => queryClient.setQueryData(k, d)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: candidateKeys.all }),
  });
}
