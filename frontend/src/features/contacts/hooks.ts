import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateContactRequest, UUID } from '@/api/types';
import { clientKeys } from '@/features/clients/hooks';
import { contactsApi, type ContactsListParams } from '@/api/contacts';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const contactKeys = {
  all: ['contacts'] as const,
  list: (params: ContactsListParams) => [...contactKeys.all, 'list', params] as const,
  detail: (id: UUID) => [...contactKeys.all, 'detail', id] as const,
};

export function useContacts(params: ContactsListParams = {}) {
  return useQuery({
    queryKey: contactKeys.list(params),
    queryFn: () => contactsApi.list(params),
    ...QUERY_DEFAULTS,
  });
}

export function useContact(id: UUID | undefined) {
  return useQuery({
    queryKey: contactKeys.detail(id ?? ''),
    queryFn: () => contactsApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: CreateContactRequest }) =>
      contactsApi.update(id, payload),
    onSuccess: (contact) => {
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
      queryClient.invalidateQueries({ queryKey: contactKeys.detail(contact.id) });
      queryClient.invalidateQueries({ queryKey: clientKeys.contacts(contact.clientId) });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: UUID; clientId?: UUID }) => contactsApi.remove(id),
    onSuccess: (_data, { id, clientId }) => {
      queryClient.removeQueries({ queryKey: contactKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: clientKeys.contacts(clientId) });
      }
    },
  });
}
