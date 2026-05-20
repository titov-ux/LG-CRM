import { api } from './client';
import type { ActivityEntry, Client, Contact, CreateClientNoteRequest, CreateContactRequest, Page, UUID } from './types';

export interface ClientsListParams {
  search?: string;
  status?: string;
  accountManagerId?: UUID;
  page?: number;
  pageSize?: number;
}

export const clientsApi = {
  list: (params: ClientsListParams = {}) =>
    api.get('clients', { searchParams: params as Record<string, string | number> }).json<Page<Client>>(),
  byId: (id: UUID) => api.get(`clients/${id}`).json<Client>(),
  contacts: (id: UUID) => api.get(`clients/${id}/contacts`).json<Contact[]>(),
  createContact: (clientId: UUID, payload: CreateContactRequest) =>
    api.post(`clients/${clientId}/contacts`, { json: payload }).json<Contact>(),
  create: (payload: Partial<Client>) => api.post('clients', { json: payload }).json<Client>(),
  update: (id: UUID, payload: Partial<Client>) => api.patch(`clients/${id}`, { json: payload }).json<Client>(),
  remove: (id: UUID) => api.delete(`clients/${id}`).json<{ ok: true }>(),
  notes: (id: UUID) => api.get(`clients/${id}/notes`).json<ActivityEntry[]>(),
  createNote: (id: UUID, payload: CreateClientNoteRequest) =>
    api.post(`clients/${id}/notes`, { json: payload }).json<ActivityEntry>(),
};
