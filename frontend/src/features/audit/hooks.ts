import { useQuery } from '@tanstack/react-query';
import { auditApi, type AuditParams } from '@/api/audit';

export const auditKeys = {
  all: ['audit'] as const,
  list: (params: AuditParams) => [...auditKeys.all, params] as const,
};

export function useAudit(params: AuditParams = {}) {
  return useQuery({
    queryKey: auditKeys.list(params),
    queryFn: () => auditApi.audit(params),
  });
}
