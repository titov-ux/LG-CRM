import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi, type TasksListParams } from '@/api/tasks';
import { auditApi } from '@/api/audit';
import type { Task, TaskStatus, UUID } from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const taskKeys = {
  all: ['tasks'] as const,
  list: (params: TasksListParams) => [...taskKeys.all, 'list', params] as const,
  byId: (id: UUID) => [...taskKeys.all, 'byId', id] as const,
  activity: (id: UUID) => [...taskKeys.all, 'activity', id] as const,
};

/** Локально применяет смену статуса: daysInStatus/completedAt как на бэке. */
function withStatus(t: Task, status: TaskStatus): Task {
  if (t.status === status) return t;
  return {
    ...t,
    status,
    daysInStatus: 0,
    completedAt: status === 'done' ? new Date().toISOString() : null,
  };
}

export function useTasks(params: TasksListParams = {}) {
  return useQuery({
    queryKey: taskKeys.list(params),
    queryFn: () => tasksApi.list(params),
    ...QUERY_DEFAULTS,
  });
}

export function useTask(id: UUID | undefined) {
  return useQuery({
    queryKey: taskKeys.byId(id ?? ''),
    queryFn: () => tasksApi.byId(id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useTaskActivity(id: UUID | undefined) {
  return useQuery({
    queryKey: taskKeys.activity(id ?? ''),
    queryFn: () => auditApi.activity('task', id as UUID),
    enabled: !!id,
    ...QUERY_DEFAULTS,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Task>) => tasksApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: Partial<Task> }) =>
      tasksApi.update(id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(taskKeys.byId(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => tasksApi.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: taskKeys.byId(id) });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useReorderTasksKanban() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: { id: UUID; status: TaskStatus; kanbanOrder: number }[]) =>
      tasksApi.reorderKanban(updates),
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });
      const previous = queryClient.getQueriesData<{ items: Task[] }>({ queryKey: taskKeys.all });
      const updateMap = new Map(updates.map((u) => [u.id, u]));
      previous.forEach(([key, data]) => {
        if (!data?.items) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((t) => {
            const u = updateMap.get(t.id);
            if (!u) return t;
            return { ...withStatus(t, u.status), kanbanOrder: u.kanbanOrder };
          }),
        });
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useChangeTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: UUID; status: TaskStatus }) =>
      tasksApi.changeStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });
      const previous = queryClient.getQueriesData<{ items: Task[] }>({ queryKey: taskKeys.all });
      previous.forEach(([key, data]) => {
        if (!data?.items) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((t) => (t.id === id ? withStatus(t, status) : t)),
        });
      });
      const byIdKey = taskKeys.byId(id);
      const previousById = queryClient.getQueryData<Task>(byIdKey);
      if (previousById) {
        queryClient.setQueryData(byIdKey, withStatus(previousById, status));
      }
      return { previous, previousById, byIdKey };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(taskKeys.byId(updated.id), updated);
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (ctx?.previousById !== undefined) {
        queryClient.setQueryData(ctx.byIdKey, ctx.previousById);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
