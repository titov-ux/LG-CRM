// Публичный портал подписания /sign/* — без JWT CRM.
// Вход: ссылка из письма + SMS-код → httpOnly-cookie `hr_sign_session` (30 минут).
// Отдельный ky-инстанс: общий `api` подставляет Bearer и на 401 пытается
// обновить токен CRM, а сотруднику-аутстаффу это не нужно.

import ky from 'ky';
import { API_BASE_URL } from '@/lib/constants';
import type {
  EmployeeDocsApi,
  HrChallenge,
  HrEmployeeSelf,
  HrPortalDocument,
  HrSignResult,
  HrSigningKey,
} from './hrEdo';

const portal = ky.create({
  prefixUrl: API_BASE_URL,
  credentials: 'include',
  timeout: 60_000,
  retry: { limit: 0 },
});

export interface PortalLinkInfo {
  employeeName: string;
  companyName: string;
  phoneMasked: string;
  expiresAt: string;
}

export const hrSignApi = {
  linkInfo: (token: string) => portal.get(`sign/${token}`).json<PortalLinkInfo>(),
  loginOtp: (token: string) => portal.post(`sign/${token}/login/otp`).json<HrChallenge>(),
  loginVerify: (token: string, challengeId: string, code: string) =>
    portal.post(`sign/${token}/login/verify`, { json: { challengeId, code } }).json<HrEmployeeSelf>(),
  session: () => portal.get('sign/session').json<HrEmployeeSelf>(),
  logout: () => portal.post('sign/session/logout').json<{ ok: boolean }>(),
};

export const portalDocsApi: EmployeeDocsApi = {
  documents: () => portal.get('sign/session/documents').json<HrPortalDocument[]>(),
  fileUrl: (id) => `${API_BASE_URL}/sign/session/documents/${id}/file`,
  fileBlob: (id) => portal.get(`sign/session/documents/${id}/file`).blob(),
  viewed: (id, toEnd) =>
    portal.post(`sign/session/documents/${id}/viewed`, { json: { toEnd } }).json<HrPortalDocument>(),
  reject: (id, reason) =>
    portal.post(`sign/session/documents/${id}/reject`, { json: { reason } }).json<HrPortalDocument>(),
  keyOtp: () => portal.post('sign/session/key/otp').json<HrChallenge>(),
  keyIssue: (challengeId, code) =>
    portal.post('sign/session/key/issue', { json: { challengeId, code } }).json<HrSigningKey>(),
  challenge: (documentIds) =>
    portal.post('sign/session/challenges', { json: { documentIds } }).json<HrChallenge>(),
  confirm: (challengeId, code) =>
    portal.post(`sign/session/challenges/${challengeId}/confirm`, { json: { code } }).json<HrSignResult>(),
};
