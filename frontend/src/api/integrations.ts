import { api } from './client';
import type { Candidate, UUID } from './types';

export interface HhStatus {
  /** Заполнены client_id/client_secret в .env бэка. */
  configured: boolean;
  /** Есть валидная пара токенов в БД (аккаунт подключён). */
  connected: boolean;
  /** Что показать пользователю — email менеджера hh. */
  accountLabel: string | null;
  /** ISO-дата истечения текущего access_token (для UI «истекает через …»). */
  expiresAt: string | null;
}

export interface HhAuthorizeUrl {
  authorizeUrl: string;
  state: string;
}

export interface HhImportResumePayload {
  url: string;
  vacancyId?: UUID;
  recruiterId?: UUID;
}

export const integrationsApi = {
  hh: {
    status: () => api.get('integrations/hh/status').json<HhStatus>(),
    oauthStart: () => api.post('integrations/hh/oauth/start').json<HhAuthorizeUrl>(),
    oauthExchange: (code: string, state: string) =>
      api
        .post('integrations/hh/oauth/exchange', { json: { code, state } })
        .json<HhStatus>(),
    disconnect: () => api.post('integrations/hh/disconnect').json<{ ok: true }>(),
    importResume: (payload: HhImportResumePayload) =>
      api
        .post('integrations/hh/import-resume', { json: payload, timeout: 30_000 })
        .json<Candidate>(),
  },
};
