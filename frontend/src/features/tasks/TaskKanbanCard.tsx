import { AlignLeft, CalendarClock, CheckCircle2, Clock } from 'lucide-react';
import type { Task, User } from '@/api/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn } from '@/lib/utils';
import { daysUntil, formatShortDate } from './statuses';

interface Props {
  task: Task;
  assignee?: User;
}

/** Бейдж срока с цветовой логикой срочности (как у тендеров). */
function DueBadge({ task }: { task: Task }) {
  const days = daysUntil(task.dueDate);
  if (days === null) return null;

  if (task.status === 'done') {
    return (
      <span
        className="tnum inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        title={`Срок: ${formatShortDate(task.dueDate)}`}
      >
        <CalendarClock className="h-2.5 w-2.5" strokeWidth={2} />
        {formatShortDate(task.dueDate)}
      </span>
    );
  }

  const tone =
    days < 0 || days <= 1
      ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
      : days <= 3
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-muted text-muted-foreground';

  const suffix =
    days < 0 ? 'просрочено' : days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `${days} дн`;

  return (
    <span
      className={cn(
        'tnum inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
        tone,
      )}
      title={`Срок: ${formatShortDate(task.dueDate)}`}
    >
      <CalendarClock className="h-2.5 w-2.5" strokeWidth={2} />
      {formatShortDate(task.dueDate)} · {suffix}
    </span>
  );
}

export function TaskKanbanCard({ task, assignee }: Props) {
  const done = task.status === 'done';
  const showPriority = task.priority === 'urgent' || task.priority === 'high';

  return (
    <>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div
          className={cn(
            'line-clamp-3 text-[13px] font-semibold leading-[17px] tracking-tight',
            done && 'text-muted-foreground line-through decoration-muted-foreground/40',
          )}
        >
          {task.title}
        </div>
        {showPriority && !done && (
          <span
            className={cn(
              'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
              task.priority === 'urgent' ? 'bg-red-500' : 'bg-amber-500',
            )}
            title={task.priority === 'urgent' ? 'Срочно' : 'Высокий приоритет'}
          />
        )}
      </div>

      {task.description && (
        <div className="mb-2 flex gap-1.5 text-[11.5px] leading-[15px] text-muted-foreground">
          <AlignLeft className="mt-px h-3 w-3 shrink-0" strokeWidth={1.8} />
          <span className="line-clamp-2 whitespace-pre-line">{task.description}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {done ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
              Выполнено
            </span>
          ) : (
            <span className="tnum inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" strokeWidth={2} />
              {task.daysInStatus}д
            </span>
          )}
          <DueBadge task={task} />
        </div>
        {assignee ? (
          <UserAvatar user={assignee} size={22} interactive={false} />
        ) : (
          <span className="shrink-0 text-[10.5px] text-muted-foreground/60">без исп.</span>
        )}
      </div>
    </>
  );
}
