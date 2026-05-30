import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calendarApi, type CalendarRangeParams } from '@/api/calendar';
import { vacancyKeys } from '@/features/vacancies/hooks';
import { candidateKeys } from '@/features/candidates/hooks';
import type { CreateEventRequest, OutcomeRequest, UpdateEventRequest, UUID } from '@/api/types';

export const calendarKeys = {
  all: ['calendar'] as const,
  range: (params: CalendarRangeParams) => ['calendar', 'range', params] as const,
};

export function useCalendarEvents(params: CalendarRangeParams, enabled = true) {
  return useQuery({
    queryKey: calendarKeys.range(params),
    queryFn: () => calendarApi.list(params),
    enabled,
  });
}

function invalidateRelated(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: calendarKeys.all });
  // Назначение/исход собеса трогает связки и канбаны.
  qc.invalidateQueries({ queryKey: ['matches'] });
  qc.invalidateQueries({ queryKey: vacancyKeys.all });
  qc.invalidateQueries({ queryKey: candidateKeys.all });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateEventRequest) => calendarApi.create(payload),
    onSuccess: () => invalidateRelated(qc),
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: UpdateEventRequest }) =>
      calendarApi.update(id, payload),
    onSuccess: () => invalidateRelated(qc),
  });
}

export function useSetOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: OutcomeRequest }) =>
      calendarApi.setOutcome(id, payload),
    onSuccess: () => invalidateRelated(qc),
  });
}

export function useCancelEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: UUID; reason?: string }) => calendarApi.cancel(id, reason),
    onSuccess: () => invalidateRelated(qc),
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => calendarApi.remove(id),
    onSuccess: () => invalidateRelated(qc),
  });
}
