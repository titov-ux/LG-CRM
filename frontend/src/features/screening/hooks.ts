import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  screeningsApi,
  type CreateScreeningPayload,
  type ScreeningQuestionStatus,
  type ScreeningsListParams,
} from '@/api/screenings';
import type { UUID } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const screeningKeys = {
  all: ['screenings'] as const,
  list: (params: ScreeningsListParams) => [...screeningKeys.all, 'list', params] as const,
  byId: (id: UUID) => [...screeningKeys.all, 'byId', id] as const,
};

export function useScreenings(params: ScreeningsListParams = {}) {
  return useQuery({
    queryKey: screeningKeys.list(params),
    queryFn: () => screeningsApi.list(params),
    ...QUERY_DEFAULTS,
  });
}

export function useScreening(id: UUID | undefined) {
  return useQuery({
    queryKey: screeningKeys.byId(id ?? ''),
    queryFn: () => screeningsApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

/** Общий onSuccess: сессия приходит целиком в ответе каждой мутации. */
function useSessionMutation<TVars>(fn: (vars: TVars) => Promise<import('@/api/screenings').ScreeningSession>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (session) => {
      queryClient.setQueryData(screeningKeys.byId(session.id), session);
      queryClient.invalidateQueries({ queryKey: screeningKeys.all });
    },
  });
}

export function useCreateScreening() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateScreeningPayload) => screeningsApi.create(payload),
    onSuccess: (session) => {
      queryClient.setQueryData(screeningKeys.byId(session.id), session);
      queryClient.invalidateQueries({ queryKey: screeningKeys.all });
    },
  });
}

export function useUpdateScreening() {
  return useSessionMutation(
    ({ id, payload }: { id: UUID; payload: { telemostUrl?: string; consentConfirmed?: boolean } }) =>
      screeningsApi.update(id, payload),
  );
}

export function useStartScreening() {
  return useSessionMutation((id: UUID) => screeningsApi.start(id));
}

export function useFinishScreening() {
  return useSessionMutation(({ id, durationSec }: { id: UUID; durationSec?: number }) =>
    screeningsApi.finish(id, durationSec),
  );
}

export function useAttachScreeningAudio() {
  return useSessionMutation(({ id, fileId }: { id: UUID; fileId: UUID }) =>
    screeningsApi.attachAudio(id, fileId),
  );
}

export function useDeleteScreening() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => screeningsApi.remove(id),
    onSuccess: (_d, id) => {
      queryClient.removeQueries({ queryKey: screeningKeys.byId(id) });
      queryClient.invalidateQueries({ queryKey: screeningKeys.all });
    },
  });
}

export function useAddQuestion() {
  return useSessionMutation(
    ({ id, text, goal }: { id: UUID; text: string; goal?: string }) =>
      screeningsApi.addQuestion(id, { text, goal }),
  );
}

export function useUpdateQuestion() {
  return useSessionMutation(
    ({
      id,
      questionId,
      payload,
    }: {
      id: UUID;
      questionId: UUID;
      payload: { text?: string; status?: ScreeningQuestionStatus; position?: number };
    }) => screeningsApi.updateQuestion(id, questionId, payload),
  );
}

export function useRemoveQuestion() {
  return useSessionMutation(({ id, questionId }: { id: UUID; questionId: UUID }) =>
    screeningsApi.removeQuestion(id, questionId),
  );
}
