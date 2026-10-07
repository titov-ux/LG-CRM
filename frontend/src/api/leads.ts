import { api } from './client';
import type { Lead, LeadStatus, Page, Priority, UUID } from './types';

export interface LeadsListParams {
  search?: string;
  status?: LeadStatus;
  priority?: Priority;
  source?: string;
  accountManagerId?: UUID;
  page?: number;
  pageSize?: number;
}

export const leadsApi = {
  list: (params: LeadsListParams = {}) =>
    api
      .get('leads', { searchParams: params as Record<string, string | number> })
      .json<Page<Lead>>(),
  byId: (id: UUID) => api.get(`leads/${id}`).json<Lead>(),
  create: (payload: Partial<Lead>) => api.post('leads', { json: payload }).json<Lead>(),
  update: (id: UUID, payload: Partial<Lead>) =>
    api.patch(`leads/${id}`, { json: payload }).json<Lead>(),
  remove: (id: UUID) => api.delete(`leads/${id}`).json<{ ok: true }>(),
  changeStatus: (id: UUID, status: LeadStatus, comment?: string) =>
    api.patch(`leads/${id}/status`, { json: { status, comment } }).json<Lead>(),
  reorderKanban: (updates: { id: UUID; status: LeadStatus; kanbanOrder: number }[]) =>
    api.put('leads/kanban-order', { json: { updates } }).json<Lead[]>(),
};
