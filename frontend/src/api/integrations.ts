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

export interface TelegramStatus {
  /** На сервере задан telegram_bot_token. */
  configured: boolean;
  /** У пользователя сохранён chat_id (бот привязан). */
  connected: boolean;
  /** Тумблер доставки уведомлений в Telegram. */
  enabled: boolean;
  /** @username бота (без @) — для текстовой инструкции. */
  botUsername: string | null;
}

export interface TelegramLink {
  configured: boolean;
  token: string;
  /** Готовая ссылка t.me/<bot>?start=<token>; null, если username бота не задан. */
  deepLink: string | null;
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
  telegram: {
    status: () => api.get('integrations/telegram/status').json<TelegramStatus>(),
    linkStart: () =>
      api.post('integrations/telegram/link/start').json<TelegramLink>(),
    setEnabled: (enabled: boolean) =>
      api
        .patch('integrations/telegram/settings', { json: { enabled } })
        .json<TelegramStatus>(),
    disconnect: () =>
      api.post('integrations/telegram/disconnect').json<{ ok: true }>(),
  },
};
