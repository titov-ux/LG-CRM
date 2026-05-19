import { api } from './client';
import type { Notification, UUID } from './types';

export const notificationsApi = {
  list: () => api.get('notifications').json<Notification[]>(),
  markRead: (id: UUID) => api.patch(`notifications/${id}/read`).json<Notification>(),
  markAllRead: () => api.post('notifications/read-all').json<{ ok: true }>(),
};
