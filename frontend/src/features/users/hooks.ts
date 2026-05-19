import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@/api/users';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const userKeys = {
  all: ['users'] as const,
};

export function useUsers() {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: () => usersApi.list(),
    ...QUERY_DEFAULTS,
    staleTime: 10 * 60_000,
  });
}
