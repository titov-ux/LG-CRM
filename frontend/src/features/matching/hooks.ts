import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { matchingApi } from '@/api/matching';
import { vacancyKeys } from '@/features/vacancies/hooks';
import { candidateKeys } from '@/features/candidates/hooks';
import type { MatchStatus, UUID } from '@/api/types';

export const matchKeys = {
  byVacancy: (vacancyId: UUID) => ['matches', 'vacancy', vacancyId] as const,
  score: (matchId: string) => ['matches', 'score', matchId] as const,
};

/** Синтетический matchId для скоринга по паре vacancy+candidate. */
export function synthMatchId(vacancyId: UUID, candidateId: UUID): string {
  return `m-${vacancyId}-${candidateId}`;
}

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

/**
 * Открепить кандидата от вакансии. Принимает связку vacancyId+candidateId
 * (внутри собирает синтетический matchId формата `m-{vacancyId}-{candidateId}`,
 * который выдаёт бэкенд при GET /vacancies/:id/candidates).
 */
export function useDetachCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vacancyId, candidateId }: { vacancyId: UUID; candidateId: UUID }) =>
      matchingApi.detach(`m-${vacancyId}-${candidateId}`),
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

/**
 * Посчитать/пересчитать AI-скоринг связки (по паре vacancy+candidate).
 * Обновляет список прикреплённых кандидатов и кэш разбивки.
 */
export function useScoreMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      vacancyId,
      candidateId,
      force,
    }: {
      vacancyId: UUID;
      candidateId: UUID;
      force?: boolean;
    }) => matchingApi.score(synthMatchId(vacancyId, candidateId), force ?? false),
    onSuccess: (data, { vacancyId, candidateId }) => {
      queryClient.setQueryData(matchKeys.score(synthMatchId(vacancyId, candidateId)), data);
      queryClient.invalidateQueries({ queryKey: matchKeys.byVacancy(vacancyId) });
      queryClient.invalidateQueries({ queryKey: vacancyKeys.byId(vacancyId) });
      queryClient.invalidateQueries({ queryKey: candidateKeys.all });
    },
  });
}

/** Лениво загрузить сохранённую разбивку скоринга (без LLM). enabled — при раскрытии. */
export function useMatchScore(
  vacancyId: UUID | undefined,
  candidateId: UUID | undefined,
  enabled: boolean,
) {
  const matchId =
    vacancyId && candidateId ? synthMatchId(vacancyId, candidateId) : '';
  return useQuery({
    queryKey: matchKeys.score(matchId),
    queryFn: () => matchingApi.getScore(matchId),
    enabled: enabled && !!matchId,
    retry: false,
  });
}

/** Батч-скоринг всех прикреплённых кандидатов вакансии. */
export function useScoreVacancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vacancyId, force }: { vacancyId: UUID; force?: boolean }) =>
      matchingApi.scoreVacancy(vacancyId, force ?? false),
    onSuccess: (_data, { vacancyId }) => {
      queryClient.invalidateQueries({ queryKey: matchKeys.byVacancy(vacancyId) });
      queryClient.invalidateQueries({ queryKey: vacancyKeys.byId(vacancyId) });
    },
  });
}

export const previewKeys = {
  pair: (vacancyId: UUID, candidateId: UUID) =>
    ['matches', 'preview', vacancyId, candidateId] as const,
};

/**
 * Превью-скор кандидата под вакансию БЕЗ прикрепления (ленивый, on-demand).
 * Кэшируется по паре vacancy+candidate, чтобы не пересчитывать при ререндерах.
 */
export function useScorePreview(
  vacancyId: UUID | undefined,
  candidateId: UUID | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: previewKeys.pair(vacancyId ?? '', candidateId ?? ''),
    queryFn: () => matchingApi.scorePreview(vacancyId as UUID, candidateId as UUID),
    enabled: enabled && !!vacancyId && !!candidateId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
