// Клиент к /hr-edo/* — кадровый электронный документооборот (docs/plan-hr-edo.md).
// Раздел «Кадровые документы» (hr_edo:manage — админ и бухгалтер) и
// «Мои документы» (hr_edo:view_own). Публичный портал — см. `hrSign.ts`.
// В мок-режиме обслуживается MSW (`mocks/db/hrEdo.ts` + handlers).

import { api } from './client';
import type { UUID } from './types';

export type EmploymentType = 'ИП' | 'СМЗ' | 'ТК РФ';
export type HrEmployeeStatus = 'active' | 'dismissed';
export type HrEdoStatus =
  | 'not_invited'
  | 'notified'
  | 'consent_signed'
  | 'active'
  | 'refused'
  | 'key_revoked';
export type HrDocStatus =
  | 'draft'
  | 'frozen'
  | 'awaiting_employer'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'archived_paper';
export type HrSigType = 'unep_lg' | 'gosklyuch' | 'ukep' | 'paper';

export interface HrDocTypeField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'money' | 'number' | 'select';
  required: boolean;
  defaultFrom?: string | null;
  default?: string | null;
  options: string[];
  placeholder?: string | null;
  hint?: string | null;
}

export interface HrDocType {
  code: string;
  title: string;
  numberPrefix: string;
  contour: 'labor' | 'gph';
  employeeAction: 'none' | 'acknowledge' | 'sign';
  employeeSig: HrSigType[];
  employerSig: 'none' | 'ukep';
  signOrder: 'employer_first' | 'employee_first' | 'parallel';
  retentionYears: number;
  uploadOnly: boolean;
  paperOnly: boolean;
  strictGroup: boolean;
  stage: number;
  description: string;
  fields: HrDocTypeField[];
}

export interface HrSigningKey {
  id: UUID;
  fingerprint: string;
  algorithm: string;
  issuedAt: string;
  revokedAt?: string | null;
  revokeReason?: string | null;
  phoneMasked: string;
  isTest: boolean;
}

export interface HrEmployee {
  id: UUID;
  userId?: UUID | null;
  userName?: string | null;
  candidateId?: UUID | null;
  fullName: string;
  position: string;
  employmentType: EmploymentType;
  phone?: string | null;
  phoneMasked?: string | null;
  phoneVerifiedAt?: string | null;
  email?: string | null;
  hiredAt?: string | null;
  dismissedAt?: string | null;
  status: HrEmployeeStatus;
  edoStatus: HrEdoStatus;
  edoConsentDocId?: UUID | null;
  activeKey?: HrSigningKey | null;
  pendingDocuments: number;
  createdAt: string;
  updatedAt: string;
}

export interface HrSignature {
  id: UUID;
  signerRole: 'employer' | 'employee';
  signerName: string;
  sigType: HrSigType;
  signedAt: string;
  tspTime?: string | null;
  fingerprint?: string | null;
  phoneMasked?: string | null;
  certSubject?: string | null;
  certIssuer?: string | null;
  certSerial?: string | null;
  hasFile: boolean;
  isTest: boolean;
  verification: Record<string, unknown>;
}

export interface HrDocument {
  id: UUID;
  employeeId: UUID;
  employeeName: string;
  typeCode: string;
  title: string;
  number?: string | null;
  docDate: string;
  status: HrDocStatus;
  fields: Record<string, unknown>;
  contentSha256?: string | null;
  contentStreebog256?: string | null;
  frozenAt?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  signedAt?: string | null;
  dueAt?: string | null;
  batchId?: UUID | null;
  hasSource: boolean;
  hasStamped: boolean;
  cancelReason?: string | null;
  rejectReason?: string | null;
  createdBy?: UUID | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  signatures: HrSignature[];
}

export interface HrEvent {
  id: number;
  documentId?: UUID | null;
  documentTitle?: string | null;
  employeeId?: UUID | null;
  employeeName?: string | null;
  kind: string;
  actorType: 'user' | 'employee' | 'system';
  actorName: string;
  ip?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  hash: string;
  prevHash: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateHrEmployeePayload {
  fullName: string;
  position?: string;
  employmentType?: EmploymentType;
  phone?: string | null;
  email?: string | null;
  hiredAt?: string | null;
  userId?: UUID | null;
  candidateId?: UUID | null;
}

export type UpdateHrEmployeePayload = Partial<CreateHrEmployeePayload> & {
  dismissedAt?: string | null;
  status?: HrEmployeeStatus;
};

export interface CreateHrDocumentsPayload {
  typeCode: string;
  employeeIds: UUID[];
  fields: Record<string, unknown>;
  title?: string | null;
  docDate?: string | null;
  freeze?: boolean;
}

export interface HrSendResponse {
  items: HrDocument[];
  /** employeeId → ссылка на портал, если письмо не ушло (нет email / SMTP). */
  portalLinks: Record<string, string>;
}

export interface HrInviteResponse {
  employee: HrEmployee;
  document: HrDocument;
  emailSent: boolean;
  portalUrl?: string | null;
}

export interface HrChainCheck {
  ok: boolean;
  checked: number;
  brokenAtId?: number | null;
  reason?: string | null;
}

export interface HrDevSms {
  phone: string;
  text: string;
  sentAt: string;
}

// ── Сотрудник о себе (общие типы портала и «Моих документов») ──

export interface HrChallenge {
  challengeId: UUID;
  phoneMasked: string;
  expiresAt: string;
  resendAfter: number;
  documentIds: UUID[];
}

export interface HrPortalDocument {
  id: UUID;
  typeCode: string;
  title: string;
  number?: string | null;
  docDate: string;
  status: HrDocStatus;
  employeeAction: 'none' | 'acknowledge' | 'sign';
  /** unep_lg — подпись кодом здесь; external — пакет согласия вне системы. */
  signMethod: 'unep_lg' | 'external' | 'none';
  canSign: boolean;
  dueAt?: string | null;
  sentAt?: string | null;
  signedAt?: string | null;
  viewedAt?: string | null;
  contentStreebog256?: string | null;
  signatures: HrSignature[];
}

export interface HrEmployeeSelf {
  id: UUID;
  fullName: string;
  position: string;
  edoStatus: HrEdoStatus;
  phoneMasked?: string | null;
  email?: string | null;
  key?: HrSigningKey | null;
  companyName: string;
  pendingCount: number;
}

export interface HrSignResult {
  signed: UUID[];
  documents: HrPortalDocument[];
}

/**
 * Операции сотрудника над своими документами. Одинаковый контракт у
 * портала (`/sign/session/*`) и «Моих документов» (`/hr-edo/my/*`) — общие
 * компоненты SigningFlow / KeyIssueFlow работают через этот адаптер.
 */
export interface EmployeeDocsApi {
  documents: () => Promise<HrPortalDocument[]>;
  fileUrl: (id: UUID) => string;
  fileBlob: (id: UUID) => Promise<Blob>;
  viewed: (id: UUID, toEnd: boolean) => Promise<HrPortalDocument>;
  reject: (id: UUID, reason: string) => Promise<HrPortalDocument>;
  keyOtp: () => Promise<HrChallenge>;
  keyIssue: (challengeId: UUID, code: string) => Promise<HrSigningKey>;
  challenge: (documentIds: UUID[]) => Promise<HrChallenge>;
  confirm: (challengeId: UUID, code: string) => Promise<HrSignResult>;
}

type Query = Record<string, string | number | boolean | undefined>;

function clean(params: Query): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null),
  ) as Record<string, string | number | boolean>;
}

function form(data: Record<string, string | Blob | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== null) fd.append(k, v);
  }
  return fd;
}

// Мультипарт и PDF — дольше обычного JSON (рендер Playwright на бэке).
const SLOW = { timeout: 60_000 };

export interface HrEmployeesParams {
  q?: string;
  edoStatus?: HrEdoStatus;
  employmentType?: EmploymentType;
  status?: HrEmployeeStatus;
  page?: number;
  pageSize?: number;
}

export interface HrDocumentsParams {
  q?: string;
  status?: HrDocStatus;
  typeCode?: string;
  employeeId?: UUID;
  awaitingEmployer?: boolean;
  page?: number;
  pageSize?: number;
}

export const hrEdoApi = {
  docTypes: () => api.get('hr-edo/doc-types').json<HrDocType[]>(),

  // ── Сотрудники ──
  employees: (params: HrEmployeesParams = {}) =>
    api.get('hr-edo/employees', { searchParams: clean({ ...params }) }).json<Paged<HrEmployee>>(),
  employee: (id: UUID) => api.get(`hr-edo/employees/${id}`).json<HrEmployee>(),
  createEmployee: (payload: CreateHrEmployeePayload) =>
    api.post('hr-edo/employees', { json: payload }).json<HrEmployee>(),
  createFromCandidate: (candidateId: UUID) =>
    api.post(`hr-edo/employees/from-candidate/${candidateId}`).json<HrEmployee>(),
  updateEmployee: (id: UUID, payload: UpdateHrEmployeePayload) =>
    api.patch(`hr-edo/employees/${id}`, { json: payload }).json<HrEmployee>(),
  invite: (id: UUID) => api.post(`hr-edo/employees/${id}/invite`, SLOW).json<HrInviteResponse>(),
  registerConsent: (id: UUID, sigType: HrSigType, file: File, note?: string) =>
    api
      .post(`hr-edo/employees/${id}/consent`, { body: form({ sigType, note, file }), ...SLOW })
      .json<HrEmployee>(),
  refuse: (id: UUID, note?: string) =>
    api.post(`hr-edo/employees/${id}/refuse`, { json: { note: note ?? null } }).json<HrEmployee>(),
  revokeKey: (id: UUID, reason: string) =>
    api.post(`hr-edo/employees/${id}/keys/revoke`, { json: { reason } }).json<HrEmployee>(),
  changePhone: (id: UUID, phone: string, reason: string) =>
    api.post(`hr-edo/employees/${id}/phone`, { json: { phone, reason } }).json<HrEmployee>(),

  // ── Документы ──
  documents: (params: HrDocumentsParams = {}) =>
    api.get('hr-edo/documents', { searchParams: clean({ ...params }) }).json<Paged<HrDocument>>(),
  document: (id: UUID) => api.get(`hr-edo/documents/${id}`).json<HrDocument>(),
  createDocuments: (payload: CreateHrDocumentsPayload) =>
    api.post('hr-edo/documents', { json: payload, ...SLOW }).json<HrDocument[]>(),
  updateDraft: (id: UUID, payload: { fields?: Record<string, unknown>; title?: string; docDate?: string }) =>
    api.patch(`hr-edo/documents/${id}`, { json: payload }).json<HrDocument>(),
  preview: (payload: {
    typeCode: string;
    employeeId?: UUID | null;
    fields: Record<string, unknown>;
    title?: string | null;
    docDate?: string | null;
  }) => api.post('hr-edo/documents/preview', { json: payload }).text(),
  documentPreview: (id: UUID) => api.get(`hr-edo/documents/${id}/preview`).text(),
  upload: (payload: {
    employeeId: UUID;
    typeCode: string;
    title?: string;
    docDate?: string;
    file: File;
  }) =>
    api
      .post('hr-edo/documents/upload', { body: form({ ...payload }), ...SLOW })
      .json<HrDocument>(),
  freeze: (id: UUID) => api.post(`hr-edo/documents/${id}/freeze`, SLOW).json<HrDocument>(),
  send: (ids: UUID[]) => api.post('hr-edo/documents/send', { json: { ids }, ...SLOW }).json<HrSendResponse>(),
  remind: (id: UUID) => api.post(`hr-edo/documents/${id}/remind`).json<HrSendResponse>(),
  cancel: (id: UUID, reason: string) =>
    api.post(`hr-edo/documents/${id}/cancel`, { json: { reason } }).json<HrDocument>(),
  employerSignature: (id: UUID, file: File) =>
    api
      .post(`hr-edo/documents/${id}/employer-signature`, { body: form({ file }), ...SLOW })
      .json<HrDocument>(),
  paperSigned: (id: UUID, file: File) =>
    api.post(`hr-edo/documents/${id}/paper-signed`, { body: form({ file }), ...SLOW }).json<HrDocument>(),
  fileBlob: (id: UUID, kind: 'source' | 'stamped' = 'source', download = false) =>
    api
      .get(`hr-edo/documents/${id}/file`, { searchParams: { kind, download }, ...SLOW })
      .blob(),
  signatureBlob: (id: UUID, signatureId: UUID) =>
    api.get(`hr-edo/documents/${id}/signatures/${signatureId}/file`).blob(),
  documentEvents: (id: UUID) => api.get(`hr-edo/documents/${id}/events`).json<HrEvent[]>(),

  // ── Протокол ──
  events: (params: { documentId?: UUID; employeeId?: UUID; kind?: string; page?: number; pageSize?: number } = {}) =>
    api.get('hr-edo/events', { searchParams: clean({ ...params }) }).json<Paged<HrEvent>>(),
  verifyChain: () => api.get('hr-edo/events/verify').json<HrChainCheck>(),
  devSmsOutbox: () => api.get('hr-edo/dev/sms-outbox').json<HrDevSms[]>(),

  // ── Мои документы ──
  my: () => api.get('hr-edo/my').json<{ employee: HrEmployeeSelf | null }>(),
};

/** «Мои документы» — сотрудник-пользователь CRM, без SMS-входа. */
export const myDocsApi: EmployeeDocsApi = {
  documents: () => api.get('hr-edo/my/documents').json<HrPortalDocument[]>(),
  fileUrl: (id) => `hr-edo/my/documents/${id}/file`,
  fileBlob: (id) => api.get(`hr-edo/my/documents/${id}/file`, SLOW).blob(),
  viewed: (id, toEnd) =>
    api.post(`hr-edo/my/documents/${id}/viewed`, { json: { toEnd } }).json<HrPortalDocument>(),
  reject: (id, reason) =>
    api.post(`hr-edo/my/documents/${id}/reject`, { json: { reason } }).json<HrPortalDocument>(),
  keyOtp: () => api.post('hr-edo/my/key/otp').json<HrChallenge>(),
  keyIssue: (challengeId, code) =>
    api.post('hr-edo/my/key/issue', { json: { challengeId, code } }).json<HrSigningKey>(),
  challenge: (documentIds) =>
    api.post('hr-edo/my/challenges', { json: { documentIds } }).json<HrChallenge>(),
  confirm: (challengeId, code) =>
    api
      .post(`hr-edo/my/challenges/${challengeId}/confirm`, { json: { code }, ...SLOW })
      .json<HrSignResult>(),
};
