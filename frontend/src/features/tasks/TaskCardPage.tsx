import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  ArrowRight,
  ChevronLeft,
  Copy,
  Edit3,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { KanbanStatusSelect } from '@/components/kanban/KanbanStatusSelect';
import { CommentsSection } from '@/features/comments/CommentsSection';
import { useUsers } from '@/features/users/hooks';
import { useAuthStore } from '@/stores/auth';
import { apiErrorMessage, cn, formatDateRu } from '@/lib/utils';
import type { Task, TaskStatus, User } from '@/api/types';
import {
  useChangeTaskStatus,
  useCreateTask,
  useDeleteTask,
  useTask,
  useTaskActivity,
  useUpdateTask,
} from './hooks';
import { TaskForm, type TaskFormValues } from './TaskForm';
import { taskFormToPayload, taskToForm } from './formPayload';
import { daysUntil, isTaskOverdue, taskStatuses } from './statuses';

const ACTIVITY_ICON: Record<string, LucideIcon> = {
  status: ArrowRight,
  note: MessageCircle,
  create: Plus,
};
const ACTIVITY_PREVIEW_LIMIT = 5;

function toDuplicatePayload(t: Task): Partial<Task> {
  return {
    title: `${t.title} (копия)`,
    description: t.description,
    priority: t.priority,
    assigneeId: t.assigneeId,
    dueDate: t.dueDate,
    status: 'todo',
  };
}

function PersonValue({ user }: { user?: User }) {
  if (!user) return null;
  return (
    <span className="flex items-center gap-1.5">
      <UserAvatar user={user} size={20} />
      <span>{user.fullName}</span>
    </span>
  );
}

function DueValue({ task }: { task: Task }) {
  if (!task.dueDate) return null;
  const overdue = isTaskOverdue(task);
  const days = daysUntil(task.dueDate);
  return (
    <span className={cn(overdue && 'font-medium text-red-600 dark:text-red-400')}>
      {formatDateRu(task.dueDate)}
      {task.status !== 'done' && days !== null && (
        <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">
          {days < 0 ? '· просрочено' : days === 0 ? '· сегодня' : days === 1 ? '· завтра' : ''}
        </span>
      )}
    </span>
  );
}

export function TaskCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/tasks/$id' });
  const { data: task, isLoading, isError } = useTask(id);
  const {
    data: activity,
    isLoading: activityLoading,
    isError: activityError,
  } = useTaskActivity(id);
  const { data: usersData } = useUsers();
  const currentUser = useAuthStore((s) => s.user);

  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const changeStatus = useChangeTaskStatus();
  const deleteTask = useDeleteTask();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const close = () => navigate({ to: '/tasks' });
  const readOnly = currentUser?.role === 'viewer';
  const canDelete = !!task && (currentUser?.role === 'admin' || task.authorId === currentUser?.id);
  const assignee = usersData?.find((u) => u.id === task?.assigneeId);
  const author = usersData?.find((u) => u.id === task?.authorId);

  const activityItems = activity ?? [];
  const hiddenActivityCount = Math.max(activityItems.length - ACTIVITY_PREVIEW_LIMIT, 0);
  const visibleActivity = activityExpanded
    ? activityItems
    : activityItems.slice(0, ACTIVITY_PREVIEW_LIMIT);

  const handleStatusChange = (status: TaskStatus) => {
    if (!task || status === task.status) return;
    changeStatus.mutate(
      { id: task.id, status },
      {
        onSuccess: (t) =>
          toast.success(
            status === 'done'
              ? `Задача «${t.title}» выполнена`
              : `Задача «${t.title}» — статус изменён`,
          ),
        onError: async (e) => toast.error(await apiErrorMessage(e, 'Не удалось изменить статус')),
      },
    );
  };

  const handleShare = async () => {
    if (!task) return;
    const link = `${window.location.origin}/tasks/${task.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Ссылка на задачу скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };

  const handleDuplicate = () => {
    if (!task) return;
    createTask.mutate(toDuplicatePayload(task), {
      onSuccess: (t) => {
        toast.success(`Создана копия «${t.title}»`);
        navigate({ to: '/tasks/$id', params: { id: t.id } });
      },
      onError: async (e) => toast.error(await apiErrorMessage(e, 'Не удалось скопировать задачу')),
    });
  };

  const handleDelete = () => {
    if (!task) return;
    deleteTask.mutate(task.id, {
      onSuccess: () => {
        toast.success(`Задача «${task.title}» удалена`);
        setDeleteOpen(false);
        navigate({ to: '/tasks' });
      },
      onError: async (e) => toast.error(await apiErrorMessage(e, 'Не удалось удалить задачу')),
    });
  };

  const handleEdit = (values: TaskFormValues) => {
    if (!task) return;
    updateTask.mutate(
      { id: task.id, payload: taskFormToPayload(values) },
      {
        onSuccess: (t) => {
          toast.success(`Задача «${t.title}» обновлена`);
          setEditOpen(false);
        },
        onError: async (e) =>
          toast.error(await apiErrorMessage(e, 'Не удалось сохранить изменения')),
      },
    );
  };

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && close()}>
        <SheetContent hideClose className="overflow-y-auto p-0 sm:max-w-2xl">
          <SheetTitle className="sr-only">{task?.title ?? 'Задача'}</SheetTitle>
          <SheetDescription className="sr-only">Карточка задачи</SheetDescription>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={close}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {!readOnly && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!task}
                    onClick={() => setEditOpen(true)}
                    aria-label="Редактировать задачу"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!task || createTask.isPending}
                    onClick={handleDuplicate}
                    aria-label="Скопировать задачу"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={!task} aria-label="Ещё">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={handleShare}>
                    <Share2 className="mr-2 h-3.5 w-3.5" />
                    Поделиться
                  </DropdownMenuItem>
                  {canDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setDeleteOpen(true);
                        }}
                        className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-950/40"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Удалить
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Button variant="ghost" size="icon" onClick={close}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {isError && !isLoading ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Задача не найдена или была удалена.
            </div>
          ) : isLoading || !task ? (
            <div className="space-y-4 px-6 py-6">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <div className="space-y-6 px-6 py-6">
              <div className="space-y-2.5 pb-4">
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  Задача · создана {formatDateRu(task.createdAt)}
                </div>
                <div className="text-[22px] font-bold leading-tight tracking-tight">
                  {task.title}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <KanbanStatusSelect
                    statuses={taskStatuses}
                    value={task.status}
                    onValueChange={handleStatusChange}
                    disabled={changeStatus.isPending}
                    readOnly={readOnly}
                  />
                  <PriorityBadge priority={task.priority} />
                  {isTaskOverdue(task) && (
                    <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      Просрочена
                    </span>
                  )}
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 gap-x-7 gap-y-3.5 text-sm sm:grid-cols-2">
                <Field
                  label="Исполнитель"
                  value={<PersonValue user={assignee} />}
                  empty={!assignee}
                />
                <Field label="Постановщик" value={<PersonValue user={author} />} empty={!author} />
                <Field label="Срок" value={<DueValue task={task} />} empty={!task.dueDate} />
                <Field
                  label="Выполнена"
                  value={task.completedAt ? formatDateRu(task.completedAt) : undefined}
                />
              </div>

              <Section title="Описание">
                {task.description ? (
                  <div className="whitespace-pre-wrap break-words text-[13.5px] leading-6">
                    {task.description}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">Описания нет.</div>
                )}
              </Section>

              <Section title="История">
                {activityLoading && <div className="text-xs text-muted-foreground">Загрузка…</div>}
                {activityError && !activityLoading && (
                  <div className="text-xs text-red-600">Не удалось загрузить историю.</div>
                )}
                {!activityLoading && !activityError && activityItems.length === 0 && (
                  <div className="text-xs text-muted-foreground">Записей пока нет.</div>
                )}
                <div className="flex flex-col">
                  {visibleActivity.map((entry, i, arr) => {
                    const Icon = ACTIVITY_ICON[entry.kind] ?? Plus;
                    const actor = usersData?.find((u) => u.id === entry.actorId);
                    return (
                      <div key={entry.id} className="relative flex gap-2.5 pb-3.5 last:pb-0">
                        {i < arr.length - 1 && (
                          <div className="absolute bottom-0 left-[11px] top-6 w-px bg-border" />
                        )}
                        <div className="z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border bg-background">
                          <Icon className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.8} />
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] leading-5">{entry.text}</div>
                          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                            {actor?.fullName ?? '—'} ·{' '}
                            {new Date(entry.createdAt).toLocaleString('ru-RU')}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hiddenActivityCount > 0 && !activityLoading && !activityError && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setActivityExpanded((prev) => !prev)}
                  >
                    {activityExpanded ? 'Свернуть' : `Показать ещё ${hiddenActivityCount}`}
                  </Button>
                )}
              </Section>

              <Separator />

              <CommentsSection entityType="task" entityId={task.id} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Редактирование задачи</SheetTitle>
            <SheetDescription>Изменения сохраняются в карточке и на доске.</SheetDescription>
          </SheetHeader>
          {task && (
            <TaskForm
              key={task.id}
              defaultValues={taskToForm(task)}
              onSubmit={handleEdit}
              isPending={updateTask.isPending}
              onCancel={() => setEditOpen(false)}
            />
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={deleteOpen} onOpenChange={(o) => !deleteTask.isPending && setDeleteOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить задачу?</DialogTitle>
            <DialogDescription>
              {task && (
                <>
                  Задача «<span className="font-medium text-foreground">{task.title}</span>» будет
                  удалена без возможности восстановления.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteTask.isPending}
            >
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteTask.isPending}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {deleteTask.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  value,
  empty,
}: {
  label: string;
  value: React.ReactNode;
  /** Явно пустое значение (когда value — элемент, который отрисует null). */
  empty?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="break-words">{empty ? '—' : (value ?? '—')}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
