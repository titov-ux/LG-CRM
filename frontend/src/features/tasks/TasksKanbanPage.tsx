import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Flame, PenLine, Plus, UserRound } from 'lucide-react';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterBar, FilterChip, MenuItem } from '@/components/common/FilterChip';
import { useFiltersStore } from '@/stores/filters';
import { apiErrorMessage } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useUsers } from '@/features/users/hooks';
import type { Priority, Task, TaskStatus, User } from '@/api/types';
import { TASK_PRIORITY_OPTIONS, isTaskOverdue, taskAccentColor, taskStatuses } from './statuses';
import { TaskKanbanCard } from './TaskKanbanCard';
import { TaskForm, type TaskFormValues } from './TaskForm';
import { taskFormToPayload } from './formPayload';
import { useCreateTask, useReorderTasksKanban, useTasks } from './hooks';

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/** Подпись выбранного пользователя в чипе: «Я» для текущего. */
function userLabel(id: string | null, meId: string | undefined, map: Map<string, User>) {
  if (!id) return null;
  if (id === meId) return 'Я';
  return map.get(id)?.fullName ?? '—';
}

/** Список пользователей для чипа: «Я» первым пунктом, затем остальные активные. */
function UserFilterItems({
  value,
  onChange,
  me,
  users,
  anyLabel,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  me: { id: string } | null | undefined;
  users: User[];
  anyLabel: string;
}) {
  return (
    <div className="max-h-64 overflow-y-auto">
      <MenuItem selected={!value} onClick={() => onChange(null)}>
        {anyLabel}
      </MenuItem>
      {me && (
        <MenuItem selected={value === me.id} onClick={() => onChange(me.id)}>
          Я
        </MenuItem>
      )}
      {users
        .filter((u) => u.id !== me?.id)
        .map((u) => (
          <MenuItem key={u.id} selected={value === u.id} onClick={() => onChange(u.id)}>
            {u.fullName}
          </MenuItem>
        ))}
    </div>
  );
}

export function TasksKanbanPage() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const readOnly = currentUser?.role === 'viewer';
  const search = useFiltersStore((s) => s.search);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);

  // Создание — лёгкий Sheet. Редактирование/удаление — в карточке /tasks/$id.
  const [createStatus, setCreateStatus] = useState<TaskStatus | null>(null);

  const { data, isLoading } = useTasks({
    search,
    assigneeId: assigneeId ?? undefined,
    authorId: authorId ?? undefined,
    priority: priority ?? undefined,
    pageSize: 500,
  });
  const { data: usersData } = useUsers();
  const reorder = useReorderTasksKanban();
  const createTask = useCreateTask();

  const userMap = useMemo(() => new Map((usersData ?? []).map((u) => [u.id, u])), [usersData]);
  const activeUsers = useMemo(() => (usersData ?? []).filter((u) => u.isActive), [usersData]);

  const items = data?.items ?? [];
  const openCount = items.filter((t) => t.status !== 'done').length;
  const overdueCount = items.filter(isTaskOverdue).length;

  const hasActiveBoardFilters = !!assigneeId || !!authorId || !!priority;
  const resetBoardFilters = () => {
    setAssigneeId(null);
    setAuthorId(null);
    setPriority(null);
  };

  const priorityLabel = priority
    ? (TASK_PRIORITY_OPTIONS.find((p) => p.id === priority)?.label ?? null)
    : null;

  const handleCreate = (values: TaskFormValues) => {
    if (createStatus === null) return;
    createTask.mutate(
      { ...taskFormToPayload(values), status: createStatus },
      {
        onSuccess: () => {
          toast.success(`Задача «${values.title.trim()}» добавлена`);
          setCreateStatus(null);
        },
        onError: async (e) => toast.error(await apiErrorMessage(e, 'Не удалось создать задачу')),
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-4">
        <FilterBar
          globalSearch
          searchPlaceholder="Поиск задач…"
          hasActiveFilters={hasActiveBoardFilters}
          onReset={resetBoardFilters}
          leftSlot={
            readOnly ? undefined : (
              <Button
                size="sm"
                className="h-7 gap-1 px-2.5 text-[12px]"
                onClick={() => setCreateStatus('todo')}
              >
                <Plus className="h-3.5 w-3.5" />
                Задача
              </Button>
            )
          }
          rightSlot={
            <span className="tnum text-[11.5px] text-muted-foreground/80">
              {openCount} {pluralize(openCount, ['открытая', 'открытые', 'открытых'])}
              {overdueCount > 0 && (
                <span className="text-red-600 dark:text-red-400"> · {overdueCount} просроч.</span>
              )}
            </span>
          }
        >
          <FilterChip
            active={!!assigneeId}
            icon={UserRound}
            label="Исполнитель"
            value={userLabel(assigneeId, currentUser?.id, userMap)}
            onClear={() => setAssigneeId(null)}
          >
            <UserFilterItems
              value={assigneeId}
              onChange={setAssigneeId}
              me={currentUser}
              users={activeUsers}
              anyLabel="Любой исполнитель"
            />
          </FilterChip>

          <FilterChip
            active={!!authorId}
            icon={PenLine}
            label="Постановщик"
            value={userLabel(authorId, currentUser?.id, userMap)}
            onClear={() => setAuthorId(null)}
          >
            <UserFilterItems
              value={authorId}
              onChange={setAuthorId}
              me={currentUser}
              users={activeUsers}
              anyLabel="Любой постановщик"
            />
          </FilterChip>

          <FilterChip
            active={!!priority}
            icon={Flame}
            label="Приоритет"
            value={priorityLabel}
            onClear={() => setPriority(null)}
          >
            <MenuItem selected={!priority} onClick={() => setPriority(null)}>
              Любой приоритет
            </MenuItem>
            {TASK_PRIORITY_OPTIONS.map((p) => (
              <MenuItem key={p.id} selected={priority === p.id} onClick={() => setPriority(p.id)}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.dot }} />
                  {p.label}
                </span>
              </MenuItem>
            ))}
          </FilterChip>
        </FilterBar>
      </div>

      {isLoading ? (
        <div className="flex gap-2.5 p-6">
          {taskStatuses.map((s) => (
            <div key={s.id} className="w-[280px] space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ))}
        </div>
      ) : items.length === 0 && (hasActiveBoardFilters || search) ? (
        <EmptyState
          title="Задачи не найдены"
          description="По заданным фильтрам ничего не найдено. Измените или сбросьте фильтры."
        />
      ) : (
        // Пустую доску показываем с колонками — сразу видно, куда добавлять.
        <KanbanBoard<TaskStatus, Task>
          statuses={taskStatuses}
          items={items}
          dragDisabled={readOnly}
          onCardClick={(t) => navigate({ to: '/tasks/$id', params: { id: t.id } })}
          onCreate={readOnly ? undefined : (status) => setCreateStatus(status)}
          onReorder={(updates) => {
            const statusChanged = updates.find((u) => {
              const original = items.find((x) => x.id === u.id);
              return original && original.status !== u.status;
            });
            reorder.mutate(updates, {
              onSuccess: () => {
                if (statusChanged?.status === 'done') {
                  const t = items.find((x) => x.id === statusChanged.id);
                  toast.success(`Задача «${t?.title}» выполнена`);
                }
              },
              onError: async (e) =>
                toast.error(await apiErrorMessage(e, 'Не удалось изменить порядок')),
            });
          }}
          getAccentColor={(t) => (t.status === 'done' ? undefined : taskAccentColor(t.priority))}
          renderCard={(t) => (
            <TaskKanbanCard
              task={t}
              assignee={t.assigneeId ? userMap.get(t.assigneeId) : undefined}
            />
          )}
        />
      )}

      <Sheet open={createStatus !== null} onOpenChange={(o) => !o && setCreateStatus(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новая задача</SheetTitle>
            <SheetDescription>
              {createStatus
                ? `Задача попадёт в колонку «${taskStatuses.find((s) => s.id === createStatus)?.label}».`
                : null}
            </SheetDescription>
          </SheetHeader>

          {createStatus !== null && (
            <TaskForm
              onSubmit={handleCreate}
              onCancel={() => setCreateStatus(null)}
              isPending={createTask.isPending}
              submitLabel="Создать задачу"
              defaultValues={currentUser ? { assigneeId: currentUser.id } : undefined}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
