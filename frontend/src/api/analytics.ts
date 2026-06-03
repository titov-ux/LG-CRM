import { api } from './client';
import type { ClientKind, ClientStatus, VacancyStatus } from './types';

export type CompareMode = 'prev' | 'yoy' | 'none';
export type Granularity = 'auto' | 'day' | 'week' | 'month';

export interface PeriodWindow {
  from: string;
  to: string;
}

export interface CompareWindow extends PeriodWindow {
  mode: CompareMode;
}

export interface DashboardSummary {
  openVacancies: number;
  activeCandidates: number;
  closedThisMonth: number;
  hiredThisMonth: number;
  delta: {
    openVacancies: number;
    activeCandidates: number;
    closedThisMonth: number;
    hiredThisMonth: number;
  };
  period: PeriodWindow;
  compare: CompareWindow | null;
}

export interface FunnelBucket {
  status: VacancyStatus;
  count: number;
}

export interface RecruiterLoad {
  recruiterId: string;
  activeCount: number;
}

export interface TrendsPoint {
  bucket: string;
  value: number;
}

export interface TrendsResponse {
  granularity: Exclude<Granularity, 'auto'>;
  period: PeriodWindow;
  series: {
    vacanciesCreated: TrendsPoint[];
    vacanciesClosed: TrendsPoint[];
    candidatesCreated: TrendsPoint[];
    hires: TrendsPoint[];
  };
}

export interface SummaryParams {
  from?: string;
  to?: string;
  compare?: CompareMode;
}

export interface TrendsParams {
  from?: string;
  to?: string;
  granularity?: Granularity;
}

export interface PeriodParams {
  from?: string;
  to?: string;
}

// ─── Funnel v2 ────────────────────────────────────────────────────────

export type MatchStatus =
  | 'submitted'
  | 'reviewed'
  | 'interview'
  | 'offered'
  | 'accepted'
  | 'rejected_client'
  | 'rejected_internal';

export interface FunnelStage {
  status: MatchStatus;
  count: number;
  conversionPct: number;
  dropOff: number;
}

export interface FunnelResponse {
  stages: FunnelStage[];
  rejected: { client: number; internal: number; total: number };
  total: number;
  overallConversionPct: number;
  period: PeriodWindow;
}

// ─── Time-to-hire ─────────────────────────────────────────────────────

export interface TimeToHireBucket {
  label: string;
  maxDays: number | null;
  count: number;
}

export interface TimeInStage {
  status: string;
  avgDays: number;
  medianDays: number;
  sample: number;
}

export interface TimeToHireResponse {
  sampleSize: number;
  avgDays: number;
  medianDays: number;
  p90Days: number;
  distribution: TimeToHireBucket[];
  byStage: TimeInStage[];
  period: PeriodWindow;
}

// ─── Attention ────────────────────────────────────────────────────────

export interface AttentionVacancyItem {
  id: string;
  title: string;
  status?: VacancyStatus | null;
  daysInStatus?: number | null;
  daysOpen?: number | null;
  deadline?: string | null;
  daysOverdue?: number | null;
  daysLeft?: number | null;
}

export interface AttentionCandidateItem {
  id: string;
  fullName: string;
  status: string;
  daysInStatus: number;
}

export interface AttentionVacancyBlock {
  total: number;
  thresholdDays?: number | null;
  items: AttentionVacancyItem[];
}

export interface AttentionCandidateBlock {
  total: number;
  thresholdDays?: number | null;
  items: AttentionCandidateItem[];
}

export interface AttentionResponse {
  stuckVacancies: AttentionVacancyBlock;
  stuckCandidates: AttentionCandidateBlock;
  vacanciesWithoutCandidates: AttentionVacancyBlock;
  overdueDeadlines: AttentionVacancyBlock;
  deadlinesNext7Days: AttentionVacancyBlock;
  deadlinesNext14Days: { total: number };
}

// ─── Recruiter performance ────────────────────────────────────────────

export interface RecruiterMetric {
  recruiterId: string;
  fullName: string;
  candidatesCreated: number;
  presented: number;
  hired: number;
  hireRatePct: number;
  avgTimeToHireDays: number;
  totalMargin: number;
  sparkline: number[];
}

export interface RecruiterPerformanceResponse {
  items: RecruiterMetric[];
  period: PeriodWindow;
}

// ─── Client performance ──────────────────────────────────────────────

export type ClientHealthFlag =
  | 'stale'
  | 'no_open'
  | 'high_rejection'
  | 'no_vacancies_ever';

export interface ClientMetric {
  clientId: string;
  name: string;
  industry: string;
  status?: ClientStatus | null;
  clientKind?: ClientKind | null;
  vacanciesTotal: number;
  vacanciesOpen: number;
  vacanciesClosedInPeriod: number;
  hiresInPeriod: number;
  avgTimeToFillDays: number;
  monthlyMarginRunRate: number;
  presentedToHiredPct: number;
  lastVacancyAt?: string | null;
  daysSinceLastVacancy?: number | null;
  rejectionRatePct: number;
  healthFlags: ClientHealthFlag[];
  sparkline: number[];
}

export interface ClientPerformanceResponse {
  items: ClientMetric[];
  period: PeriodWindow;
}

// ─── Worklog (учёт времени в системе) ─────────────────────────────────

export type WorkSessionEndReason =
  | 'disconnect'
  | 'sweep'
  | 'server_shutdown'
  | 'reconcile';

export interface WorklogUserSummary {
  userId: string;
  fullName: string;
  totalSeconds: number;
  /** Активное время (вкладка видима + взаимодействие), пропорц. окну. */
  totalActiveSeconds: number;
  sessionsCount: number;
}

export interface WorklogSummaryResponse {
  from: string;
  to: string;
  items: WorklogUserSummary[];
}

export interface WorklogSession {
  id: string;
  userId: string | null;
  startedAt: string;
  lastHeartbeatAt: string;
  endedAt: string | null;
  endReason: WorkSessionEndReason | null;
  durationSeconds: number | null;
}

export interface WorklogParams {
  from?: string;
  to?: string;
  /** Конкретный сотрудник; для непривилегированных ролей игнорируется бэком. */
  userId?: string;
}

function toSearchParams(obj: Record<string, unknown>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p;
}

export const analyticsApi = {
  summary: (params: SummaryParams = {}) =>
    api
      .get('analytics/summary', {
        searchParams: toSearchParams(params as Record<string, unknown>),
      })
      .json<DashboardSummary>(),
  funnel: () => api.get('analytics/funnel').json<FunnelBucket[]>(),
  recruiterLoad: () => api.get('analytics/recruiter-load').json<RecruiterLoad[]>(),
  trends: (params: TrendsParams = {}) =>
    api
      .get('analytics/trends', {
        searchParams: toSearchParams(params as Record<string, unknown>),
      })
      .json<TrendsResponse>(),
  funnelV2: (params: PeriodParams = {}) =>
    api
      .get('analytics/funnel-v2', {
        searchParams: toSearchParams(params as Record<string, unknown>),
      })
      .json<FunnelResponse>(),
  timeToHire: (params: PeriodParams = {}) =>
    api
      .get('analytics/time-to-hire', {
        searchParams: toSearchParams(params as Record<string, unknown>),
      })
      .json<TimeToHireResponse>(),
  attention: (top = 5) =>
    api
      .get('analytics/attention', {
        searchParams: toSearchParams({ top: String(top) }),
      })
      .json<AttentionResponse>(),
  recruiterPerformance: (params: PeriodParams = {}) =>
    api
      .get('analytics/recruiter-performance', {
        searchParams: toSearchParams(params as Record<string, unknown>),
      })
      .json<RecruiterPerformanceResponse>(),
  clientPerformance: (params: PeriodParams = {}) =>
    api
      .get('analytics/client-performance', {
        searchParams: toSearchParams(params as Record<string, unknown>),
      })
      .json<ClientPerformanceResponse>(),
  worklogSummary: (params: WorklogParams = {}) =>
    api
      .get('analytics/worklog/summary', {
        searchParams: toSearchParams(params as Record<string, unknown>),
      })
      .json<WorklogSummaryResponse>(),
  worklogSessions: (params: WorklogParams = {}) =>
    api
      .get('analytics/worklog/sessions', {
        searchParams: toSearchParams(params as Record<string, unknown>),
      })
      .json<WorklogSession[]>(),
};
