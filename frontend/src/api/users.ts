import { api } from './client';
import type { CreateUserRequest, User, UUID } from './types';

export const usersApi = {
  list: () => api.get('users').json<User[]>(),
  create: (payload: CreateUserRequest) => api.post('users', { json: payload }).json<User>(),
  update: (id: UUID, payload: Partial<User>) =>
    api.patch(`users/${id}`, { json: payload }).json<User>(),
  remove: (id: UUID) => api.delete(`users/${id}`).json<{ ok: boolean }>(),
};
