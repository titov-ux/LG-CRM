import { useQuery } from '@tanstack/react-query';
import {
  analyticsApi,
  type PeriodParams,
  type SummaryParams,
  type TrendsParams,
  type WorklogParams,
} from '@/api/analytics';

export const analyticsKeys = {
  summary: (p: SummaryParams = {}) => ['analytics', 'summary', p] as const,
  funnel: ['analytics', 'funnel'] as const,
  recruiterLoad: ['analytics', 'recruiter-load'] as const,
  trends: (p: TrendsParams = {}) => ['analytics', 'trends', p] as const,
  funnelV2: (p: PeriodParams = {}) => ['analytics', 'funnel-v2', p] as const,
  timeToHire: (p: PeriodParams = {}) => ['analytics', 'time-to-hire', p] as const,
  attention: (top: number) => ['analytics', 'attention', top] as const,
  recruiterPerformance: (p: PeriodParams = {}) =>
    ['analytics', 'recruiter-performance', p] as const,
  clientPerformance: (p: PeriodParams = {}) =>
    ['analytics', 'client-performance', p] as const,
  weeklyActivity: (p: PeriodParams = {}) =>
    ['analytics', 'weekly-activity', p] as const,
  worklogSummary: (p: WorklogParams = {}) =>
    ['analytics', 'worklog-summary', p] as const,
  worklogSessions: (p: WorklogParams = {}) =>
    ['analytics', 'worklog-sessions', p] as const,
};

export function useSummary(params: SummaryParams = {}) {
  return useQuery({
    queryKey: analyticsKeys.summary(params),
    queryFn: () => analyticsApi.summary(params),
  });
}

export function useFunnel() {
  return useQuery({
    queryKey: analyticsKeys.funnel,
    queryFn: () => analyticsApi.funnel(),
  });
}

export function useRecruiterLoad() {
  return useQuery({
    queryKey: analyticsKeys.recruiterLoad,
    queryFn: () => analyticsApi.recruiterLoad(),
  });
}

export function useTrends(params: TrendsParams = {}) {
  return useQuery({
    queryKey: analyticsKeys.trends(params),
    queryFn: () => analyticsApi.trends(params),
  });
}

export function useFunnelV2(params: PeriodParams = {}) {
  return useQuery({
    queryKey: analyticsKeys.funnelV2(params),
    queryFn: () => analyticsApi.funnelV2(params),
  });
}

export function useTimeToHire(params: PeriodParams = {}) {
  return useQuery({
    queryKey: analyticsKeys.timeToHire(params),
    queryFn: () => analyticsApi.timeToHire(params),
  });
}

export function useAttention(top: number = 5) {
  return useQuery({
    queryKey: analyticsKeys.attention(top),
    queryFn: () => analyticsApi.attention(top),
  });
}

export function useRecruiterPerformance(params: PeriodParams = {}) {
  return useQuery({
    queryKey: analyticsKeys.recruiterPerformance(params),
    queryFn: () => analyticsApi.recruiterPerformance(params),
  });
}

export function useClientPerformance(params: PeriodParams = {}) {
  return useQuery({
    queryKey: analyticsKeys.clientPerformance(params),
    queryFn: () => analyticsApi.clientPerformance(params),
  });
}

export function useWeeklyActivity(params: PeriodParams = {}) {
  return useQuery({
    queryKey: analyticsKeys.weeklyActivity(params),
    queryFn: () => analyticsApi.weeklyActivity(params),
  });
}

export function useWorklogSummary(params: WorklogParams = {}, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.worklogSummary(params),
    queryFn: () => analyticsApi.worklogSummary(params),
    enabled,
  });
}

export function useWorklogSessions(
  params: WorklogParams = {},
  enabled = true,
) {
  return useQuery({
    queryKey: analyticsKeys.worklogSessions(params),
    queryFn: () => analyticsApi.worklogSessions(params),
    enabled,
  });
}
