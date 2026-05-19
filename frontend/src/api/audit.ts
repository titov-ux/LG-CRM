import { api } from './client';
import type { ActivityEntry, AuditEntry, UUID } from './types';

export const auditApi = {
  audit: (params: { entityType?: string; entityId?: UUID } = {}) =>
    api.get('audit', { searchParams: params as Record<string, string> }).json<AuditEntry[]>(),
  activity: (entityType: 'vacancy' | 'candidate' | 'client', entityId: UUID) =>
    api.get(`${entityType}s/${entityId}/activity`).json<ActivityEntry[]>(),
};
