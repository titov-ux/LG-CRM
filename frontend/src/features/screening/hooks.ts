import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  screeningsApi,
  type CreateScreeningPayload,
  type ScreeningQuestionStatus,
  type ScreeningSession,
  type ScreeningsListParams,
  type ScreeningsListResponse,
} from '@/api/screenings';
import type { UUID } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const screeningKeys = {
  all: ['screenings'] as const,
  list: (params: ScreeningsListParams) => [...screeningKeys.all, 'list', params] as const,
  byId: (id: UUID) => [...screeningKeys.all, 'byId', id] as const,
  segments: (id: UUID) => [...screeningKeys.all, 'segments', id] as const,
};

export function useScreeningSegments(id: UUID | undefined, enabled = true) {
  return useQuery({
    queryKey: screeningKeys.segments(id ?? ''),
    queryFn: () => screeningsApi.segments(id as UUID),
    enabled: !!id && enabled,
    ...QUERY_DEFAULTS,
  });
}

export interface UseScreeningsOptions {
  /**
   * Пока в списке есть сессия в статусе `processing` (AI готовит отчёт) —
   * опрашиваем список раз в 5 секунд, иначе поллинг выключен.
   */
  pollProcessing?: boolean;
}

const PROCESSING_POLL_MS = 5_000;

export function useScreenings(
  params: ScreeningsListParams = {},
  options: UseScreeningsOptions = {},
) {
  return useQuery({
    queryKey: screeningKeys.list(params),
    queryFn: () => screeningsApi.list(params),
    ...QUERY_DEFAULTS,
    refetchInterval: options.pollProcessing
      ? (query) => {
          const data = query.state.data as ScreeningsListResponse | undefined;
          const hasProcessing = (data?.items ?? []).some((s) => s.status === 'processing');
          return hasProcessing ? PROCESSING_POLL_MS : false;
        }
      : undefined,
  });
}

export function useScreening(id: UUID | undefined) {
  return useQuery({
    queryKey: screeningKeys.byId(id ?? ''),
    queryFn: () => screeningsApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
    // Пока идёт пост-анализ, статус меняет воркер — без поллинга в комнате
    // вечно висело бы «AI готовит отчёт…».
    refetchInterval: (query) =>
      (query.state.data as ScreeningSession | undefined)?.status === 'processing'
        ? PROCESSING_POLL_MS
        : false,
  });
}

/** Общий onSuccess: сессия приходит целиком в ответе каждой мутации. */
function useSessionMutation<TVars>(fn: (vars: TVars) => Promise<ScreeningSession>) {
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

interface UpdateQuestionVars {
  id: UUID;
  questionId: UUID;
  payload: { text?: string; goal?: string; status?: ScreeningQuestionStatus; position?: number };
}

/**
 * Правка вопроса с оптимистичным обновлением: во время встречи рекрутер кликает
 * по статусам быстро, ждать round-trip нельзя.
 *
 * Откат при ошибке — ТОЧЕЧНЫЙ (только правленый вопрос): полный снимок затирал
 * бы `questions.updated`, прилетевшие от агента по WS, пока запрос был в пути.
 */
export function useUpdateQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, questionId, payload }: UpdateQuestionVars) =>
      screeningsApi.updateQuestion(id, questionId, payload),
    onMutate: async ({ id, questionId, payload }) => {
      const key = screeningKeys.byId(id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ScreeningSession>(key);
      const previousQuestion = previous?.questions.find((q) => q.id === questionId) ?? null;
      if (previous) {
        queryClient.setQueryData<ScreeningSession>(key, {
          ...previous,
          questions: previous.questions.map((q) =>
            q.id === questionId ? { ...q, ...payload } : q,
          ),
        });
      }
      return { previousQuestion, key, questionId };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.previousQuestion) return;
      const restored = ctx.previousQuestion;
      queryClient.setQueryData<ScreeningSession>(ctx.key, (current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((q) =>
                q.id === ctx.questionId ? restored : q,
              ),
            }
          : current,
      );
    },
    onSuccess: (session) => {
      queryClient.setQueryData(screeningKeys.byId(session.id), session);
    },
    // Сервер — источник правды по чек-листу (агент правит его параллельно).
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({ queryKey: screeningKeys.byId(vars.id) });
    },
  });
}

/** Перегенерация плана вопросов AI (бэк: POST /screenings/{id}/regenerate-questions). */
export function useRegenerateQuestions() {
  return useSessionMutation((id: UUID) => screeningsApi.regenerateQuestions(id));
}

export function useRemoveQuestion() {
  return useSessionMutation(({ id, questionId }: { id: UUID; questionId: UUID }) =>
    screeningsApi.removeQuestion(id, questionId),
  );
}
