import { api } from './client';
import type { Client, Contact, CreateContactRequest, Page, UUID } from './types';

export interface ClientsListParams {
  search?: string;
  status?: string;
  accountManagerId?: UUID;
  industry?: string;
  page?: number;
  pageSize?: number;
}

function buildSearchParams(params: ClientsListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v as string | number;
  }
  return out;
}

export const clientsApi = {
  list: (params: ClientsListParams = {}) =>
    api.get('clients', { searchParams: buildSearchParams(params) }).json<Page<Client>>(),
  byId: (id: UUID) => api.get(`clients/${id}`).json<Client>(),
  contacts: (id: UUID) => api.get(`clients/${id}/contacts`).json<Contact[]>(),
  createContact: (clientId: UUID, payload: CreateContactRequest) =>
    api.post(`clients/${clientId}/contacts`, { json: payload }).json<Contact>(),
  create: (payload: Partial<Client>) => api.post('clients', { json: payload }).json<Client>(),
  update: (id: UUID, payload: Partial<Client>) => api.patch(`clients/${id}`, { json: payload }).json<Client>(),
  remove: (id: UUID) => api.delete(`clients/${id}`).json<{ ok: true }>(),
};
