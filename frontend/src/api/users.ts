import { api } from './client';
import type { User } from './types';

export const usersApi = {
  list: () => api.get('users').json<User[]>(),
};
