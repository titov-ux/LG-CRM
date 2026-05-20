import { api } from './client';
import type { ContactListItem, CreateContactRequest, Page, UUID } from './types';

export interface ContactsListParams {
  search?: string;
  clientId?: string;
  page?: number;
  pageSize?: number;
}

export const contactsApi = {
  list: (params: ContactsListParams = {}) =>
    api.get('contacts', { searchParams: params as Record<string, string | number> }).json<Page<ContactListItem>>(),
  byId: (id: UUID) => api.get(`contacts/${id}`).json<ContactListItem>(),
  update: (id: UUID, payload: CreateContactRequest) =>
    api.patch(`contacts/${id}`, { json: payload }).json<ContactListItem>(),
  remove: (id: UUID) => api.delete(`contacts/${id}`).json<{ ok: true }>(),
};
