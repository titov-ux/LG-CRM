import { api } from './client';
import type { VacancyStatus } from './types';

export interface DashboardSummary {
  openVacancies: number;
  activeCandidates: number;
  closedThisMonth: number;
  hiredThisMonth: number;
  delta: { openVacancies: number; activeCandidates: number; closedThisMonth: number; hiredThisMonth: number };
}

export interface FunnelBucket {
  status: VacancyStatus;
  count: number;
}

export interface RecruiterLoad {
  recruiterId: string;
  activeCount: number;
}

export const analyticsApi = {
  summary: () => api.get('analytics/summary').json<DashboardSummary>(),
  funnel: () => api.get('analytics/funnel').json<FunnelBucket[]>(),
  recruiterLoad: () => api.get('analytics/recruiter-load').json<RecruiterLoad[]>(),
};
