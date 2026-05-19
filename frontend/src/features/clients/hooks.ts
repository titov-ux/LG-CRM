import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi, type ClientsListParams } from '@/api/clients';
import { usersApi } from '@/api/users';
import type { Client, CreateContactRequest, UUID } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const clientKeys = {
  all: ['clients'] as const,
  list: (params: ClientsListParams) => [...clientKeys.all, 'list', params] as const,
  byId: (id: UUID) => [...clientKeys.all, 'byId', id] as const,
  contacts: (id: UUID) => [...clientKeys.all, 'contacts', id] as const,
};

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
};

export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: () => usersApi.list(),
    ...QUERY_DEFAULTS,
  });
}

export function useClients(params: ClientsListParams = {}) {
  return useQuery({
    queryKey: clientKeys.list(params),
    queryFn: () => clientsApi.list(params),
    ...QUERY_DEFAULTS,
  });
}

export function useClient(id: UUID | undefined) {
  return useQuery({
    queryKey: clientKeys.byId(id ?? ''),
    queryFn: () => clientsApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useClientContacts(id: UUID | undefined) {
  return useQuery({
    queryKey: clientKeys.contacts(id ?? ''),
    queryFn: () => clientsApi.contacts(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Client>) => clientsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: Partial<Client> }) =>
      clientsApi.update(id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(clientKeys.byId(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

export function useCreateContact(clientId: UUID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateContactRequest) => clientsApi.createContact(clientId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
