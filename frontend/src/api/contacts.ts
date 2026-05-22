import { api } from './client';
import type { ContactListItem, CreateContactRequest, Page, UUID } from './types';

export interface ContactsListParams {
  search?: string;
  clientId?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasTelegram?: boolean;
  hasBirthday?: boolean;
  page?: number;
  pageSize?: number;
}

function buildSearchParams(params: ContactsListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    out[k] = v === true ? '1' : (v as string | number);
  }
  return out;
}

export const contactsApi = {
  list: (params: ContactsListParams = {}) =>
    api.get('contacts', { searchParams: buildSearchParams(params) }).json<Page<ContactListItem>>(),
  byId: (id: UUID) => api.get(`contacts/${id}`).json<ContactListItem>(),
  update: (id: UUID, payload: CreateContactRequest) =>
    api.patch(`contacts/${id}`, { json: payload }).json<ContactListItem>(),
  remove: (id: UUID) => api.delete(`contacts/${id}`).json<{ ok: true }>(),
};
