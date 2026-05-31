import { api } from './client';
import type { MatchScore, MatchStatus, RankedCandidate, UUID, VacancyCandidate } from './types';

export const matchingApi = {
  byVacancy: (vacancyId: UUID) => api.get(`vacancies/${vacancyId}/candidates`).json<VacancyCandidate[]>(),
  attach: (vacancyId: UUID, candidateId: UUID) =>
    api.post(`vacancies/${vacancyId}/candidates`, { json: { candidateId } }).json<VacancyCandidate>(),
  changeStatus: (matchId: UUID, status: MatchStatus, feedback?: string) =>
    api.patch(`matches/${matchId}`, { json: { status, feedback } }).json<VacancyCandidate>(),
  detach: (matchId: UUID) => api.delete(`matches/${matchId}`).json<{ ok: true }>(),

  // === AI-скоринг ===
  /** Посчитать/пересчитать скоринг. matchId принимает синтетический `m-{v}-{c}`. */
  score: (matchId: string, force = false) =>
    api.post(`matches/${matchId}/score`, { searchParams: force ? { force: 'true' } : {} }).json<MatchScore>(),
  /** Сохранённый скоринг без вызова LLM (404, если ещё не считали). */
  getScore: (matchId: string) => api.get(`matches/${matchId}/score`).json<MatchScore>(),
  /** Батч-скоринг всех прикреплённых кандидатов вакансии. */
  scoreVacancy: (vacancyId: UUID, force = false) =>
    api
      .post(`vacancies/${vacancyId}/candidates/score`, { searchParams: force ? { force: 'true' } : {} })
      .json<MatchScore[]>(),
  /** Превью-скор кандидата под вакансию без прикрепления. */
  scorePreview: (vacancyId: UUID, candidateId: UUID) =>
    api.post(`vacancies/${vacancyId}/candidates/score-preview`, { json: { candidateId } }).json<MatchScore>(),
  /** Подбор кандидатов из базы под вакансию (ранжирование). enrich — дообогатить топ LLM. */
  rank: (vacancyId: UUID, limit = 20, enrich = false) =>
    api
      .get(`vacancies/${vacancyId}/candidates/rank`, {
        searchParams: { limit: String(limit), enrich: enrich ? 'true' : 'false' },
      })
      .json<RankedCandidate[]>(),
};
