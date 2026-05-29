import { api } from './client';
import type { UUID } from './types';

export interface ApiTokenItem {
  id: UUID;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateApiTokenResponse {
  item: ApiTokenItem;
  /** Plain-токен. Показываем пользователю ОДИН раз — потом восстановить нельзя. */
  rawToken: string;
}

export const apiTokensApi = {
  list: () => api.get('me/api-tokens').json<ApiTokenItem[]>(),
  create: (name: string) =>
    api.post('me/api-tokens', { json: { name } }).json<CreateApiTokenResponse>(),
  revoke: (id: UUID) => api.delete(`me/api-tokens/${id}`).json<{ ok: true }>(),
};
