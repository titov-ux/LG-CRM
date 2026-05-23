import { api } from './client';
import type { LoginRequest, TokenResponse, User } from './types';

export const authApi = {
  login: (payload: LoginRequest) => api.post('auth/login', { json: payload }).json<TokenResponse>(),
  logout: () => api.post('auth/logout').json<{ ok: true }>(),
  me: () => api.get('auth/me').json<User>(),
  updateMe: (payload: { fullName?: string; email?: string; telegram?: string | null }) =>
    api.patch('auth/me', { json: payload }).json<User>(),
  refresh: () => api.post('auth/refresh').json<{ accessToken: string }>(),
};
