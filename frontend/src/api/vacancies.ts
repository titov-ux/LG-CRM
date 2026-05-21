import { api } from './client';
import type { EngagementType, Page, UUID, Vacancy, VacancyStatus } from './types';
import type { ParsedVacancy } from '@/features/vacancies/types';

export interface VacanciesListParams {
  search?: string;
  status?: VacancyStatus;
  clientId?: UUID;
  grade?: string;
  priority?: string;
  recruiterId?: UUID;
  engagementType?: EngagementType;
  page?: number;
  pageSize?: number;
}

export const vacanciesApi = {
  list: (params: VacanciesListParams = {}) =>
    api.get('vacancies', { searchParams: params as Record<string, string | number> }).json<Page<Vacancy>>(),
  byId: (id: UUID) => api.get(`vacancies/${id}`).json<Vacancy>(),
  create: (payload: Partial<Vacancy>) => api.post('vacancies', { json: payload }).json<Vacancy>(),
  update: (id: UUID, payload: Partial<Vacancy>) => api.patch(`vacancies/${id}`, { json: payload }).json<Vacancy>(),
  remove: (id: UUID) => api.delete(`vacancies/${id}`).json<{ ok: true }>(),
  changeStatus: (id: UUID, status: VacancyStatus, comment?: string) =>
    api.patch(`vacancies/${id}/status`, { json: { status, comment } }).json<Vacancy>(),
  reorderKanban: (updates: { id: UUID; status: VacancyStatus; kanbanOrder: number }[]) =>
    api.put('vacancies/kanban-order', { json: { updates } }).json<Vacancy[]>(),
  /** AI-распознавание сплошного текста брифа → структурированные поля формы. */
  parseText: (text: string) =>
    api.post('vacancies/parse-text', { json: { text } }).json<{ parsed: ParsedVacancy }>(),
};
