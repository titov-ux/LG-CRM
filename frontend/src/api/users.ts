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
  update: (id: UUID, payload: Partial<User>) =>
    api.patch(`users/${id}`, { json: payload }).json<User>(),
  remove: (id: UUID) => api.delete(`users/${id}`).json<{ ok: boolean }>(),
  resendInvite: (id: UUID) =>
    api.post(`users/${id}/invite`).json<InviteResendResponse>(),
};
