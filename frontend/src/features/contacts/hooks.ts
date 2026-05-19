import { useQuery } from '@tanstack/react-query';
import { contactsApi, type ContactsListParams } from '@/api/contacts';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const contactKeys = {
  all: ['contacts'] as const,
  list: (params: ContactsListParams) => [...contactKeys.all, 'list', params] as const,
};

export function useContacts(params: ContactsListParams = {}) {
  return useQuery({
    queryKey: contactKeys.list(params),
    queryFn: () => contactsApi.list(params),
    ...QUERY_DEFAULTS,
  });
}
