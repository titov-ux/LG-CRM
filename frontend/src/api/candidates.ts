import { api } from './client';
import type { Candidate, CandidateStatus, Page, UUID } from './types';

export interface CandidatesListParams {
  search?: string;
  status?: CandidateStatus;
  grade?: string;
  recruiterId?: UUID;
  stack?: string;
  page?: number;
  pageSize?: number;
}

export const candidatesApi = {
  list: (params: CandidatesListParams = {}) =>
    api.get('candidates', { searchParams: params as Record<string, string | number> }).json<Page<Candidate>>(),
  byId: (id: UUID) => api.get(`candidates/${id}`).json<Candidate>(),
  create: (payload: Partial<Candidate>) => api.post('candidates', { json: payload }).json<Candidate>(),
  update: (id: UUID, payload: Partial<Candidate>) =>
    api.patch(`candidates/${id}`, { json: payload }).json<Candidate>(),
  changeStatus: (id: UUID, status: CandidateStatus, comment?: string) =>
    api.patch(`candidates/${id}/status`, { json: { status, comment } }).json<Candidate>(),
};
