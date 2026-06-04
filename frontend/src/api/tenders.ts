import { api } from './client';
import type { Page, Priority, Tender, TenderLaw, TenderStatus, UUID } from './types';

export interface TendersListParams {
  search?: string;
  status?: TenderStatus;
  law?: TenderLaw;
  priority?: Priority;
  platform?: string;
  accountManagerId?: UUID;
  page?: number;
  pageSize?: number;
}

export const tendersApi = {
  list: (params: TendersListParams = {}) =>
    api
      .get('tenders', { searchParams: params as Record<string, string | number> })
      .json<Page<Tender>>(),
  byId: (id: UUID) => api.get(`tenders/${id}`).json<Tender>(),
  create: (payload: Partial<Tender>) => api.post('tenders', { json: payload }).json<Tender>(),
  update: (id: UUID, payload: Partial<Tender>) =>
    api.patch(`tenders/${id}`, { json: payload }).json<Tender>(),
  remove: (id: UUID) => api.delete(`tenders/${id}`).json<{ ok: true }>(),
  changeStatus: (id: UUID, status: TenderStatus, comment?: string) =>
    api.patch(`tenders/${id}/status`, { json: { status, comment } }).json<Tender>(),
  reorderKanban: (updates: { id: UUID; status: TenderStatus; kanbanOrder: number }[]) =>
    api.put('tenders/kanban-order', { json: { updates } }).json<Tender[]>(),
};
