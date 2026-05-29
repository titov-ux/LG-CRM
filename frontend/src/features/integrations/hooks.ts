import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationsApi, type HhImportResumePayload } from '@/api/integrations';

const KEY = ['integrations', 'hh', 'status'] as const;

export function useHhStatus() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => integrationsApi.hh.status(),
    staleTime: 30_000,
  });
}

export function useHhStartOAuth() {
  return useMutation({
    mutationFn: () => integrationsApi.hh.oauthStart(),
  });
}

export function useHhExchangeCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, state }: { code: string; state: string }) =>
      integrationsApi.hh.oauthExchange(code, state),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useHhDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => integrationsApi.hh.disconnect(),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useHhImportResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: HhImportResumePayload) => integrationsApi.hh.importResume(payload),
    onSuccess: () => {
      // Обновляем оба представления — базу кандидатов и канбан вакансии.
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['vacancyCandidates'] });
    },
  });
}
