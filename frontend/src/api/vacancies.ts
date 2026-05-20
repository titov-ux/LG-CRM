import { api } from './client';
import type { Page, UUID, Vacancy, VacancyStatus } from './types';

export interface VacanciesListParams {
  search?: string;
  status?: VacancyStatus;
  clientId?: UUID;
  grade?: string;
  priority?: string;
  recruiterId?: UUID;
  page?: number;
  pageSize?: number;
}

export const vacanciesApi = {
  list: (params: VacanciesListParams = {}) =>
    api.get('vacancies', { searchParams: params as Record<string, string | number> }).json<Page<Vacancy>>(),
  byId: (id: UUID) => api.get(`vacancies/${id}`).json<Vacancy>(),
  create: (payload: Partial<Vacancy>) => api.post('vacancies', { json: payload }).json<Vacancy>(),
  update: (id: UUID, payload: Partial<Vacancy>) => api.patch(`vacancies/${id}`, { json: payload }).json<Vacancy>(),
  changeStatus: (id: UUID, status: VacancyStatus, comment?: string) =>
    api.patch(`vacancies/${id}/status`, { json: { status, comment } }).json<Vacancy>(),
  reorderKanban: (updates: { id: UUID; status: VacancyStatus; kanbanOrder: number }[]) =>
    api.put('vacancies/kanban-order', { json: { updates } }).json<Vacancy[]>(),
};
