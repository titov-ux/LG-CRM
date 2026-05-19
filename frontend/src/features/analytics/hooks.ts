import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '@/api/analytics';

export const analyticsKeys = {
  summary: ['analytics', 'summary'] as const,
  funnel: ['analytics', 'funnel'] as const,
  recruiterLoad: ['analytics', 'recruiter-load'] as const,
};

export function useSummary() {
  return useQuery({ queryKey: analyticsKeys.summary, queryFn: () => analyticsApi.summary() });
}
export function useFunnel() {
  return useQuery({ queryKey: analyticsKeys.funnel, queryFn: () => analyticsApi.funnel() });
}
export function useRecruiterLoad() {
  return useQuery({ queryKey: analyticsKeys.recruiterLoad, queryFn: () => analyticsApi.recruiterLoad() });
}
