import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hrEdoApi,
  type CreateHrDocumentsPayload,
  type CreateHrEmployeePayload,
  type HrDocumentsParams,
  type HrEmployeesParams,
  type HrSigType,
  type UpdateHrEmployeePayload,
} from '@/api/hrEdo';
import type { UUID } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';
import { useCan } from '@/lib/permissions';

export const hrKeys = {
  all: ['hr-edo'] as const,
  docTypes: () => [...hrKeys.all, 'doc-types'] as const,
  employees: (p: HrEmployeesParams) => [...hrKeys.all, 'employees', p] as const,
  employee: (id: UUID) => [...hrKeys.all, 'employee', id] as const,
  documents: (p: HrDocumentsParams) => [...hrKeys.all, 'documents', p] as const,
  document: (id: UUID) => [...hrKeys.all, 'document', id] as const,
  documentEvents: (id: UUID) => [...hrKeys.all, 'document-events', id] as const,
  events: (p: object) => [...hrKeys.all, 'events', p] as const,
  chain: () => [...hrKeys.all, 'chain'] as const,
  my: () => [...hrKeys.all, 'my'] as const,
  myDocs: () => [...hrKeys.all, 'my-docs'] as const,
};

export function useDocTypes() {
  return useQuery({
    queryKey: hrKeys.docTypes(),
    queryFn: hrEdoApi.docTypes,
    staleTime: 10 * 60_000,
  });
}

export function useHrEmployees(params: HrEmployeesParams = {}, enabled = true) {
  return useQuery({
    queryKey: hrKeys.employees(params),
    queryFn: () => hrEdoApi.employees(params),
    enabled,
    ...QUERY_DEFAULTS,
  });
}

export function useHrEmployee(id: UUID | null | undefined) {
  return useQuery({
    queryKey: hrKeys.employee(id ?? ''),
    queryFn: () => hrEdoApi.employee(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useHrDocuments(params: HrDocumentsParams = {}, enabled = true) {
  return useQuery({
    queryKey: hrKeys.documents(params),
    queryFn: () => hrEdoApi.documents(params),
    enabled,
    ...QUERY_DEFAULTS,
  });
}

export function useHrDocument(id: UUID | null | undefined) {
  return useQuery({
    queryKey: hrKeys.document(id ?? ''),
    queryFn: () => hrEdoApi.document(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useHrDocumentEvents(id: UUID | null | undefined) {
  return useQuery({
    queryKey: hrKeys.documentEvents(id ?? ''),
    queryFn: () => hrEdoApi.documentEvents(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useHrEvents(params: { page?: number; pageSize?: number; kind?: string }, enabled = true) {
  return useQuery({
    queryKey: hrKeys.events(params),
    queryFn: () => hrEdoApi.events(params),
    enabled,
    ...QUERY_DEFAULTS,
  });
}

export function useChainCheck(enabled = true) {
  return useQuery({
    queryKey: hrKeys.chain(),
    queryFn: hrEdoApi.verifyChain,
    enabled,
    ...QUERY_DEFAULTS,
  });
}

/** «Мои документы»: статус и число неподписанных (бейдж в сайдбаре). */
export function useMyHr() {
  const canViewOwn = useCan('hr_edo:view_own');
  return useQuery({
    queryKey: hrKeys.my(),
    queryFn: hrEdoApi.my,
    enabled: canViewOwn,
    ...QUERY_DEFAULTS,
    retry: false,
    refetchInterval: 60_000,
  });
}

/** Любая мутация раздела инвалидирует весь кэш hr-edo — данных немного. */
function useHrMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.all }),
  });
}

export const useCreateHrEmployee = () =>
  useHrMutation((p: CreateHrEmployeePayload) => hrEdoApi.createEmployee(p));
export const useCreateFromCandidate = () =>
  useHrMutation((candidateId: UUID) => hrEdoApi.createFromCandidate(candidateId));
export const useUpdateHrEmployee = () =>
  useHrMutation(({ id, patch }: { id: UUID; patch: UpdateHrEmployeePayload }) =>
    hrEdoApi.updateEmployee(id, patch),
  );
export const useInviteEmployee = () => useHrMutation((id: UUID) => hrEdoApi.invite(id));
export const useRegisterConsent = () =>
  useHrMutation(
    ({ id, sigType, file, note }: { id: UUID; sigType: HrSigType; file: File; note?: string }) =>
      hrEdoApi.registerConsent(id, sigType, file, note),
  );
export const useRefuseEdo = () =>
  useHrMutation(({ id, note }: { id: UUID; note?: string }) => hrEdoApi.refuse(id, note));
export const useRevokeKey = () =>
  useHrMutation(({ id, reason }: { id: UUID; reason: string }) => hrEdoApi.revokeKey(id, reason));
export const useChangePhone = () =>
  useHrMutation(({ id, phone, reason }: { id: UUID; phone: string; reason: string }) =>
    hrEdoApi.changePhone(id, phone, reason),
  );

export const useCreateHrDocuments = () =>
  useHrMutation((p: CreateHrDocumentsPayload) => hrEdoApi.createDocuments(p));
export const useUploadHrDocument = () =>
  useHrMutation((p: Parameters<typeof hrEdoApi.upload>[0]) => hrEdoApi.upload(p));
export const useFreezeDocument = () => useHrMutation((id: UUID) => hrEdoApi.freeze(id));
export const useSendDocuments = () => useHrMutation((ids: UUID[]) => hrEdoApi.send(ids));
export const useRemindDocument = () => useHrMutation((id: UUID) => hrEdoApi.remind(id));
export const useCancelDocument = () =>
  useHrMutation(({ id, reason }: { id: UUID; reason: string }) => hrEdoApi.cancel(id, reason));
export const useEmployerSignature = () =>
  useHrMutation(({ id, file }: { id: UUID; file: File }) => hrEdoApi.employerSignature(id, file));
export const usePaperSigned = () =>
  useHrMutation(({ id, file }: { id: UUID; file: File }) => hrEdoApi.paperSigned(id, file));
