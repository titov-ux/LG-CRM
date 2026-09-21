import { api } from './client';
import type { UUID } from './types';

export type LoginSnapshotStatus = 'ok' | 'denied' | 'no_camera' | 'error';

export interface LoginSnapshotItem {
  id: UUID;
  userId: UUID | null;
  userFullName: string | null;
  userEmail: string | null;
  status: LoginSnapshotStatus;
  imageUrl: string | null; // presigned GET, короткий TTL; null если кадра нет
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface LoginSnapshotParams {
  userId?: UUID;
  dateFrom?: string; // YYYY-MM-DD, включительно
  dateTo?: string; // YYYY-MM-DD, включительно
  limit?: number;
}

export const loginSnapshotsApi = {
  list: (params: LoginSnapshotParams = {}) => {
    const searchParams: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') searchParams[k] = String(v);
    });
    return api.get('security/login-snapshots', { searchParams }).json<LoginSnapshotItem[]>();
  },
};
