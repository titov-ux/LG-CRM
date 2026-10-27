import type { Priority, TaskStatus } from '@/api/types';
import type { KanbanStatusDescriptor } from '@/components/kanban/types';

// Колонки доски задач: К выполнению → В работе → На проверке → Готово.
export const taskStatuses: KanbanStatusDescriptor<TaskStatus>[] = [
  { id: 'todo', label: 'К выполнению', color: '#94a3b8' },
  { id: 'in_progress', label: 'В работе', color: '#3b82f6' },
  { id: 'review', label: 'На проверке', color: '#f59e0b' },
  { id: 'done', label: 'Готово', color: '#10b981' },
];

export const TASK_PRIORITY_OPTIONS: { id: Priority; label: string; dot: string }[] = [
  { id: 'urgent', label: 'Срочно', dot: '#ef4444' },
  { id: 'high', label: 'Высокий', dot: '#f59e0b' },
  { id: 'medium', label: 'Средний', dot: '#94a3b8' },
  { id: 'low', label: 'Низкий', dot: '#cbd5e1' },
];

/** Левый акцент карточки — цвет приоритета (только для заметных приоритетов). */
export function taskAccentColor(priority: Priority): string | undefined {
  if (priority === 'urgent') return '#ef4444';
  if (priority === 'high') return '#f59e0b';
  return undefined;
}

function parseISODate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Дней до срока (отрицательное — просрочено). null — срок не задан. */
export function daysUntil(iso?: string | null): number | null {
  const target = parseISODate(iso);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function formatShortDate(iso?: string | null): string {
  const d = parseISODate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

export function isTaskOverdue(task: { dueDate?: string | null; status: TaskStatus }): boolean {
  if (task.status === 'done') return false;
  const days = daysUntil(task.dueDate);
  return days !== null && days < 0;
}
