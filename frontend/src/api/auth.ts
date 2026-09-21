import { api } from './client';
import type {
  ActivateInviteRequest,
  InviteInfo,
  LoginRequest,
  TokenResponse,
  User,
} from './types';

export const authApi = {
  login: (payload: LoginRequest) => api.post('auth/login', { json: payload }).json<TokenResponse>(),
  logout: () => api.post('auth/logout').json<{ ok: true }>(),
  me: () => api.get('auth/me').json<User>(),
  updateMe: (payload: { fullName?: string; email?: string; telegram?: string | null }) =>
    api.patch('auth/me', { json: payload }).json<User>(),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    api.post('auth/me/password', { json: payload }).json<{ ok: true }>(),
  refresh: () => api.post('auth/refresh').json<{ accessToken: string }>(),
  // ── Invite-flow (публичные эндпоинты, без auth) ─────────────────────────
  inviteInfo: (token: string) => api.get(`auth/invite/${token}`).json<InviteInfo>(),
  inviteActivate: (token: string, payload: ActivateInviteRequest) =>
    api.post(`auth/invite/${token}/activate`, { json: payload }).json<TokenResponse>(),
};
