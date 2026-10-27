import type { Task } from '@/api/types';
import type { TaskFormValues } from './TaskForm';

/** Значения формы → payload API (пустые строки → null). */
export function taskFormToPayload(values: TaskFormValues): Partial<Task> {
  return {
    title: values.title.trim(),
    description: values.description?.trim() || null,
    priority: values.priority,
    assigneeId: values.assigneeId || null,
    dueDate: values.dueDate || null,
  };
}

export function taskToForm(t: Task): Partial<TaskFormValues> {
  return {
    title: t.title,
    description: t.description ?? '',
    priority: t.priority,
    assigneeId: t.assigneeId ?? '',
    dueDate: t.dueDate ?? '',
  };
}
