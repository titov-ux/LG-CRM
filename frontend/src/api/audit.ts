import { api } from './client';
import type { ActivityEntry, AuditEntry, UUID } from './types';

export interface AuditParams {
  entityType?: string;
  entityId?: UUID;
  actorId?: UUID;
  field?: string;
  dateFrom?: string; // ISO date (YYYY-MM-DD), включительно
  dateTo?: string;   // ISO date (YYYY-MM-DD), включительно
  search?: string;
}

export const auditApi = {
  audit: (params: AuditParams = {}) => {
    // ky выкидывает undefined/пустые значения некорректно — отфильтруем сами.
    const searchParams: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') searchParams[k] = String(v);
    });
    return api.get('audit', { searchParams }).json<AuditEntry[]>();
  },
  activity: (entityType: 'vacancy' | 'candidate' | 'client', entityId: UUID) =>
    api.get(`${entityType}s/${entityId}/activity`).json<ActivityEntry[]>(),
};
