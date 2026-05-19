import { api } from './client';
import type { LoginRequest, TokenResponse, User } from './types';

export const authApi = {
  login: (payload: LoginRequest) => api.post('auth/login', { json: payload }).json<TokenResponse>(),
  logout: () => api.post('auth/logout').json<{ ok: true }>(),
  me: () => api.get('auth/me').json<User>(),
  refresh: () => api.post('auth/refresh').json<{ accessToken: string }>(),
};
