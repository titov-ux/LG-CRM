// ky-инстанс с auth-interceptor и автоматическим refresh.
// Архитектурно соответствует §2 / §7.

import ky from 'ky';
import { API_BASE_URL } from '@/lib/constants';
import { getClientId } from '@/lib/clientId';
import { useAuthStore } from '@/stores/auth';

let refreshPromise: Promise<void> | null = null;

async function refreshAccess(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await ky
        .post(`${API_BASE_URL}/auth/refresh`, { credentials: 'include' })
        .json<{ accessToken: string }>();
      useAuthStore.getState().setAccessToken(res.accessToken);
    } catch (e) {
      useAuthStore.getState().clear();
      throw e;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export const api = ky.create({
  prefixUrl: API_BASE_URL,
  credentials: 'include',
  timeout: 15_000,
  retry: { limit: 0 },
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().accessToken;
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        // Корреляция со своими же realtime-событиями (echo-suppress на фронте).
        request.headers.set('X-Client-Id', getClientId());
      },
    ],
    afterResponse: [
      async (request, _options, response) => {
        if (response.status !== 401) return response;
        if (request.url.endsWith('/auth/refresh') || request.url.endsWith('/auth/login')) return response;
        try {
          await refreshAccess();
          const token = useAuthStore.getState().accessToken;
          if (token) request.headers.set('Authorization', `Bearer ${token}`);
          return ky(request);
        } catch {
          return response;
        }
      },
    ],
  },
});
