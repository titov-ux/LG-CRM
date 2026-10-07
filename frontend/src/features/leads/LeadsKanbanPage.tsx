import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Briefcase, Flame, Plus, Radio } from 'lucide-react';
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
import type { Lead, LeadStatus, Priority } from '@/api/types';
import {
  LEAD_OWNER_ROLES,
  LEAD_OWN_ONLY_ROLES,
  LEAD_PRIORITY_COLOR,
  LEAD_SOURCES,
  isFinalLeadStatus,
  leadStatuses,
} from './statuses';
import { LeadKanbanCard } from './LeadKanbanCard';
import { LeadForm, type LeadFormValues } from './LeadForm';
import { formatCompactRub, leadFormToPayload } from './utils';
import { LeadFinalStatusDialog } from './LeadFinalStatusDialog';
import { useChangeLeadStatus, useCreateLead, useLeads, useReorderLeadsKanban } from './hooks';

const PRIORITY_OPTIONS: { id: Priority; label: string }[] = [
  { id: 'urgent', label: 'Срочно' },
  { id: 'high', label: 'Высокий' },
  { id: 'medium', label: 'Средний' },
  { id: 'low', label: 'Низкий' },
];
const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Срочно',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function LeadsKanbanPage() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const search = useFiltersStore((s) => s.search);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [accountManagerId, setAccountManagerId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  // Создание лида — лёгкий Sheet. Редактирование/удаление живут на карточке
  // /leads/$id (как у тендеров и вакансий).
  const [createStatus, setCreateStatus] = useState<LeadStatus | null>(null);
  const [finalDrop, setFinalDrop] = useState<{ id: string; status: LeadStatus } | null>(null);

  const { data, isLoading } = useLeads({
    search,
    priority: priority ?? undefined,
    accountManagerId: accountManagerId ?? undefined,
    source: source ?? undefined,
    pageSize: 200,
  });
  const { data: usersData } = useUsers();
  const queryClient = useQueryClient();

  const reorder = useReorderLeadsKanban();
  const changeStatus = useChangeLeadStatus();
  const createLead = useCreateLead();

  const userMap = useMemo(
    () => new Map((usersData ?? []).map((u) => [u.id, u])),
    [usersData],
  );
  const accountManagers = useMemo(
    () => (usersData ?? []).filter((u) => LEAD_OWNER_ROLES.includes(u.role)),
    [usersData],
  );

  const items = data?.items ?? [];
  const totalCount = items.length;
  // Сумма потенциала по открытым лидам (без Сделки / Отказа).
  const pipelineValue = items
    .filter((l) => !isFinalLeadStatus(l.status))
    .reduce((sum, l) => sum + (l.expectedValue ?? 0), 0);

  const hasActiveBoardFilters = !!priority || !!accountManagerId || !!source;
  const resetBoardFilters = () => {
    setPriority(null);
    setAccountManagerId(null);
    setSource(null);
  };

  const priorityLabel = priority ? PRIORITY_LABEL[priority] : null;
  const accountManagerLabel = accountManagerId
    ? userMap.get(accountManagerId)?.fullName ?? '—'
    : null;

  const handleCreate = (values: LeadFormValues) => {
    if (createStatus === null) return;
    createLead.mutate(
      // Бэкенд требует непустой title, а поля «Потребность» в форме нет — берём компанию.
      { ...leadFormToPayload(values), title: values.company.trim(), status: createStatus },
      {
        onSuccess: () => {
          toast.success(`Лид «${values.company}» добавлен`);
          setCreateStatus(null);
        },
        onError: async (e) => toast.error(await apiErrorMessage(e, 'Не удалось создать лид')),
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-4">
        <FilterBar
          globalSearch
          searchPlaceholder="Поиск по компании, контакту, телефону…"
          hasActiveFilters={hasActiveBoardFilters}
          onReset={resetBoardFilters}
          leftSlot={
            <Button
              size="sm"
              className="h-7 gap-1 px-2.5 text-[12px]"
              onClick={() => setCreateStatus('new')}
            >
              <Plus className="h-3.5 w-3.5" />
              Лид
            </Button>
          }
          rightSlot={
            <span className="tnum text-[11.5px] text-muted-foreground/80">
              {totalCount} {pluralize(totalCount, ['лид', 'лида', 'лидов'])}
              {pipelineValue > 0 && <> · в работе {formatCompactRub(pipelineValue)}</>}
            </span>
          }
        >
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
            {PRIORITY_OPTIONS.map((p) => (
              <MenuItem key={p.id} selected={priority === p.id} onClick={() => setPriority(p.id)}>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: LEAD_PRIORITY_COLOR[p.id] }}
                  />
                  {p.label}
                </span>
              </MenuItem>
            ))}
          </FilterChip>

          <FilterChip
            active={!!accountManagerId}
            icon={Briefcase}
            label="Ответственный"
            value={accountManagerLabel}
            onClear={() => setAccountManagerId(null)}
          >
            <div className="max-h-64 overflow-y-auto">
              <MenuItem selected={!accountManagerId} onClick={() => setAccountManagerId(null)}>
                Любой ответственный
              </MenuItem>
              {accountManagers.map((u) => (
                <MenuItem
                  key={u.id}
                  selected={accountManagerId === u.id}
                  onClick={() => setAccountManagerId(u.id)}
                >
                  {u.fullName}
                </MenuItem>
              ))}
            </div>
          </FilterChip>

          <FilterChip
            active={!!source}
            icon={Radio}
            label="Источник"
            value={source}
            onClear={() => setSource(null)}
          >
            <div className="max-h-64 overflow-y-auto">
              <MenuItem selected={!source} onClick={() => setSource(null)}>
                Любой источник
              </MenuItem>
              {LEAD_SOURCES.map((s) => (
                <MenuItem key={s} selected={source === s} onClick={() => setSource(s)}>
                  {s}
                </MenuItem>
              ))}
            </div>
          </FilterChip>
        </FilterBar>
      </div>

      {isLoading ? (
        <div className="flex gap-2.5 p-6">
          {leadStatuses.map((s) => (
            <div key={s.id} className="w-[280px] space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Нет лидов"
          description={
            hasActiveBoardFilters || search
              ? 'По заданным фильтрам ничего не найдено. Измените или сбросьте фильтры.'
              : 'Добавьте первого потенциального клиента кнопкой «Лид» вверху.'
          }
        />
      ) : (
        <KanbanBoard<LeadStatus, Lead>
          statuses={leadStatuses}
          items={items}
          onCardClick={(l) => navigate({ to: '/leads/$id', params: { id: l.id } })}
          onCreate={(status) => setCreateStatus(status)}
          onReorder={(updates) => {
            const statusChanged = updates.find((u) => {
              const original = items.find((x) => x.id === u.id);
              return original && original.status !== u.status;
            });
            if (statusChanged && isFinalLeadStatus(statusChanged.status)) {
              setFinalDrop({ id: statusChanged.id, status: statusChanged.status });
              return;
            }
            reorder.mutate(updates, {
              onSuccess: () => {
                if (statusChanged) {
                  const l = items.find((x) => x.id === statusChanged.id);
                  toast.success(`Лид «${l?.company || l?.title}» — статус изменён`);
                }
              },
              onError: async (e) =>
                toast.error(await apiErrorMessage(e, 'Не удалось изменить порядок')),
            });
          }}
          getAccentColor={(l) => LEAD_PRIORITY_COLOR[l.priority]}
          renderCard={(l) => (
            <LeadKanbanCard
              lead={l}
              accountManager={l.accountManagerId ? userMap.get(l.accountManagerId) : undefined}
            />
          )}
        />
      )}

      <Sheet open={createStatus !== null} onOpenChange={(o) => !o && setCreateStatus(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новый лид</SheetTitle>
            <SheetDescription>
              Компания, контактное лицо и суть запроса. Статус — колонка, в которую попадёт лид.
            </SheetDescription>
          </SheetHeader>

          {createStatus !== null && (
            <LeadForm
              onSubmit={handleCreate}
              onCancel={() => setCreateStatus(null)}
              isPending={createLead.isPending}
              submitLabel="Создать лид"
              defaultValues={
                currentUser && LEAD_OWN_ONLY_ROLES.includes(currentUser.role)
                  ? { accountManagerId: currentUser.id }
                  : undefined
              }
            />
          )}
        </SheetContent>
      </Sheet>

      <LeadFinalStatusDialog
        open={finalDrop !== null}
        targetStatus={finalDrop?.status ?? null}
        pending={changeStatus.isPending}
        onOpenChange={(o) => {
          if (!o && !changeStatus.isPending) setFinalDrop(null);
        }}
        onConfirm={(comment) => {
          if (!finalDrop) return;
          changeStatus.mutate(
            { id: finalDrop.id, status: finalDrop.status, comment },
            {
              onSuccess: (l) => {
                setFinalDrop(null);
                toast.success(`Лид «${l.company || l.title}» — статус изменён`);
                queryClient.invalidateQueries();
              },
              onError: () => toast.error('Не удалось изменить статус'),
            },
          );
        }}
      />
    </div>
  );
}
