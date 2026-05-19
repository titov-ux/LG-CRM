import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { matchingApi } from '@/api/matching';
import { vacancyKeys } from '@/features/vacancies/hooks';
import { candidateKeys } from '@/features/candidates/hooks';
import type { MatchStatus, UUID } from '@/api/types';

export const matchKeys = {
  byVacancy: (vacancyId: UUID) => ['matches', 'vacancy', vacancyId] as const,
};

export function useMatchesByVacancy(vacancyId: UUID | undefined) {
  return useQuery({
    queryKey: matchKeys.byVacancy(vacancyId ?? ''),
    queryFn: () => matchingApi.byVacancy(vacancyId as UUID),
    enabled: !!vacancyId,
  });
}

export function useAttachCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vacancyId, candidateId }: { vacancyId: UUID; candidateId: UUID }) =>
      matchingApi.attach(vacancyId, candidateId),
    onSuccess: (_data, { vacancyId }) => {
      queryClient.invalidateQueries({ queryKey: matchKeys.byVacancy(vacancyId) });
      queryClient.invalidateQueries({ queryKey: vacancyKeys.all });
      queryClient.invalidateQueries({ queryKey: candidateKeys.all });
    },
  });
}

export function useChangeMatchStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, status, feedback }: { matchId: UUID; status: MatchStatus; feedback?: string }) =>
      matchingApi.changeStatus(matchId, status, feedback),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['matches'] }),
  });
}
