import { api } from './client';
import type {
  CalendarEvent,
  CreateEventRequest,
  OutcomeRequest,
  UpdateEventRequest,
  UUID,
} from './types';

export interface CalendarRangeParams {
  from: string; // ISO
  to: string; // ISO
  recruiterId?: UUID;
  vacancyId?: UUID;
  candidateId?: UUID;
  status?: string;
  type?: string;
}

function toSearch(params: CalendarRangeParams): Record<string, string> {
  const sp: Record<string, string> = { from: params.from, to: params.to };
  if (params.recruiterId) sp.recruiterId = params.recruiterId;
  if (params.vacancyId) sp.vacancyId = params.vacancyId;
  if (params.candidateId) sp.candidateId = params.candidateId;
  if (params.status) sp.status = params.status;
  if (params.type) sp.type = params.type;
  return sp;
}

export const calendarApi = {
  list: (params: CalendarRangeParams) =>
    api.get('calendar/events', { searchParams: toSearch(params) }).json<CalendarEvent[]>(),
  get: (id: UUID) => api.get(`calendar/events/${id}`).json<CalendarEvent>(),
  create: (payload: CreateEventRequest) =>
    api.post('calendar/events', { json: payload }).json<CalendarEvent>(),
  update: (id: UUID, payload: UpdateEventRequest) =>
    api.patch(`calendar/events/${id}`, { json: payload }).json<CalendarEvent>(),
  setOutcome: (id: UUID, payload: OutcomeRequest) =>
    api.post(`calendar/events/${id}/outcome`, { json: payload }).json<CalendarEvent>(),
  cancel: (id: UUID, reason?: string) =>
    api.post(`calendar/events/${id}/cancel`, { json: { reason } }).json<CalendarEvent>(),
  remove: (id: UUID) => api.delete(`calendar/events/${id}`).json<{ ok: true }>(),
};
