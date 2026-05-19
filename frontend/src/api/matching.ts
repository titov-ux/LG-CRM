import { api } from './client';
import type { MatchStatus, UUID, VacancyCandidate } from './types';

export const matchingApi = {
  byVacancy: (vacancyId: UUID) => api.get(`vacancies/${vacancyId}/candidates`).json<VacancyCandidate[]>(),
  attach: (vacancyId: UUID, candidateId: UUID) =>
    api.post(`vacancies/${vacancyId}/candidates`, { json: { candidateId } }).json<VacancyCandidate>(),
  changeStatus: (matchId: UUID, status: MatchStatus, feedback?: string) =>
    api.patch(`matches/${matchId}`, { json: { status, feedback } }).json<VacancyCandidate>(),
  detach: (matchId: UUID) => api.delete(`matches/${matchId}`).json<{ ok: true }>(),
};
