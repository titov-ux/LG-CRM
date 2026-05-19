import { useQuery } from '@tanstack/react-query';
import { auditApi } from '@/api/audit';

export const auditKeys = {
  all: ['audit'] as const,
};

export function useAudit() {
  return useQuery({ queryKey: auditKeys.all, queryFn: () => auditApi.audit() });
}
