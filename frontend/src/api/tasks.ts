import { api } from './client';
import type { Page, Priority, Task, TaskStatus, UUID } from './types';

export interface TasksListParams {
  search?: string;
  status?: TaskStatus;
  priority?: Priority;
  assigneeId?: UUID;
  authorId?: UUID;
  page?: number;
  pageSize?: number;
}

export const tasksApi = {
  list: (params: TasksListParams = {}) =>
    api
      .get('tasks', { searchParams: params as Record<string, string | number> })
      .json<Page<Task>>(),
  byId: (id: UUID) => api.get(`tasks/${id}`).json<Task>(),
  create: (payload: Partial<Task>) => api.post('tasks', { json: payload }).json<Task>(),
  update: (id: UUID, payload: Partial<Task>) =>
    api.patch(`tasks/${id}`, { json: payload }).json<Task>(),
  remove: (id: UUID) => api.delete(`tasks/${id}`).json<{ ok: true }>(),
  changeStatus: (id: UUID, status: TaskStatus) =>
    api.patch(`tasks/${id}/status`, { json: { status } }).json<Task>(),
  reorderKanban: (updates: { id: UUID; status: TaskStatus; kanbanOrder: number }[]) =>
    api.put('tasks/kanban-order', { json: { updates } }).json<Task[]>(),
};
