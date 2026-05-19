import { api } from './client';
import type { ContactListItem, Page } from './types';

export interface ContactsListParams {
  search?: string;
  clientId?: string;
  page?: number;
  pageSize?: number;
}

export const contactsApi = {
  list: (params: ContactsListParams = {}) =>
    api.get('contacts', { searchParams: params as Record<string, string | number> }).json<Page<ContactListItem>>(),
};
