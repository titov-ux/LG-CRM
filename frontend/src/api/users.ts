import { api } from './client';
import type {
  CreateUserRequest,
  CreateUserResponse,
  InviteResendResponse,
  User,
  UUID,
} from './types';

export const usersApi = {
  list: () => api.get('users').json<User[]>(),
  create: (payload: CreateUserRequest) =>
    api.post('users', { json: payload }).json<CreateUserResponse>(),
  // telegram: null — явная очистка поля на бэке (PATCH с exclude_unset).
  update: (id: UUID, payload: Omit<Partial<User>, 'telegram'> & { telegram?: string | null }) =>
    api.patch(`users/${id}`, { json: payload }).json<User>(),
  remove: (id: UUID) => api.delete(`users/${id}`).json<{ ok: boolean }>(),
  // Админский сброс пароля: все сессии пользователя разлогиниваются.
  setPassword: (id: UUID, password: string) =>
    api.post(`users/${id}/password`, { json: { password } }).json<{ ok: boolean }>(),
  resendInvite: (id: UUID) =>
    api.post(`users/${id}/invite`).json<InviteResendResponse>(),
};
