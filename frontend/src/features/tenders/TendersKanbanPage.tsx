import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Briefcase, Flame, Landmark, Plus, Server } from 'lucide-react';
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
import type { Priority, Tender, TenderLaw, TenderStatus } from '@/api/types';
import {
  TENDER_LAW_META,
  TENDER_LAW_OPTIONS,
  TENDER_PLATFORMS,
  isFinalTenderStatus,
  tenderStatuses,
} from './statuses';
import { TenderKanbanCard } from './TenderKanbanCard';
import { TenderForm, type TenderFormValues } from './TenderForm';
import { TenderFinalStatusDialog } from './TenderFinalStatusDialog';
import {
  useChangeTenderStatus,
  useCreateTender,
  useReorderTendersKanban,
  useTenders,
} from './hooks';

const PRIORITY_OPTIONS: { id: Priority; label: string; dot: string }[] = [
  { id: 'urgent', label: 'Срочно', dot: '#ef4444' },
  { id: 'high', label: 'Высокий', dot: '#f59e0b' },
  { id: 'medium', label: 'Средний', dot: '#94a3b8' },
  { id: 'low', label: 'Низкий', dot: '#cbd5e1' },
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

/** Преобразует значения формы в payload API (числа/пустые строки → null). */
function formToPayload(values: TenderFormValues): Partial<Tender> {
  const num = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? null : v);
  return {
    title: values.title,
    customer: values.customer,
    law: values.law,
    registryNumber: values.registryNumber?.trim() || null,
    platform: values.platform?.trim() || null,
    nmck: num(values.nmck) ?? 0,
    ourPrice: num(values.ourPrice),
    submissionDeadline: values.submissionDeadline || null,
    priority: values.priority,
    accountManagerId: values.accountManagerId || null,
    url: values.url?.trim() || null,
  };
}

export function TendersKanbanPage() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const search = useFiltersStore((s) => s.search);
  const [law, setLaw] = useState<TenderLaw | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [accountManagerId, setAccountManagerId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);

  // Создание тендера — лёгкий Sheet. Редактирование/удаление живут на карточке
  // /tenders/$id (как у вакансий).
  const [createStatus, setCreateStatus] = useState<TenderStatus | null>(null);
  const [finalDrop, setFinalDrop] = useState<{
    id: string;
    status: TenderStatus;
    title?: string;
  } | null>(null);

  const { data, isLoading } = useTenders({
    search,
    law: law ?? undefined,
    priority: priority ?? undefined,
    accountManagerId: accountManagerId ?? undefined,
    platform: platform ?? undefined,
    pageSize: 200,
  });
  const { data: usersData } = useUsers();
  const queryClient = useQueryClient();

  const reorder = useReorderTendersKanban();
  const changeStatus = useChangeTenderStatus();
  const createTender = useCreateTender();

  const userMap = useMemo(
    () => new Map((usersData ?? []).map((u) => [u.id, u])),
    [usersData],
  );
  const accountManagers = useMemo(
    () => (usersData ?? []).filter((u) => u.role === 'account_manager' || u.role === 'admin'),
    [usersData],
  );

  const items = data?.items ?? [];
  const totalCount = items.length;

  const hasActiveBoardFilters = !!law || !!priority || !!accountManagerId || !!platform;
  const resetBoardFilters = () => {
    setLaw(null);
    setPriority(null);
    setAccountManagerId(null);
    setPlatform(null);
  };

  const lawLabel = law ? TENDER_LAW_META[law].label : null;
  const priorityLabel = priority ? PRIORITY_LABEL[priority] : null;
  const accountManagerLabel = accountManagerId
    ? userMap.get(accountManagerId)?.fullName ?? '—'
    : null;

  const handleCreate = (values: TenderFormValues) => {
    if (createStatus === null) return;
    createTender.mutate(
      { ...formToPayload(values), status: createStatus },
      {
        onSuccess: () => {
          toast.success(`Тендер «${values.title}» добавлен`);
          setCreateStatus(null);
        },
        onError: async (e) =>
          toast.error(await apiErrorMessage(e, 'Не удалось создать тендер')),
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-4">
        <FilterBar
          hasActiveFilters={hasActiveBoardFilters}
          onReset={resetBoardFilters}
          leftSlot={
            <Button
              size="sm"
              className="h-7 gap-1 px-2.5 text-[12px]"
              onClick={() => setCreateStatus('lead')}
            >
              <Plus className="h-3.5 w-3.5" />
              Тендер
            </Button>
          }
          rightSlot={
            <span className="tnum text-[11.5px] text-muted-foreground/80">
              {totalCount} {pluralize(totalCount, ['тендер', 'тендера', 'тендеров'])}
            </span>
          }
        >
          <FilterChip
            active={!!law}
            icon={Landmark}
            label="Закон"
            value={lawLabel}
            onClear={() => setLaw(null)}
          >
            <MenuItem selected={!law} onClick={() => setLaw(null)}>
              Любой закон
            </MenuItem>
            {TENDER_LAW_OPTIONS.map((o) => (
              <MenuItem key={o.id} selected={law === o.id} onClick={() => setLaw(o.id)}>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: TENDER_LAW_META[o.id].color }}
                  />
                  {o.label}
                </span>
              </MenuItem>
            ))}
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
            {PRIORITY_OPTIONS.map((p) => (
              <MenuItem key={p.id} selected={priority === p.id} onClick={() => setPriority(p.id)}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.dot }} />
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
            active={!!platform}
            icon={Server}
            label="Площадка"
            value={platform}
            onClear={() => setPlatform(null)}
          >
            <div className="max-h-64 overflow-y-auto">
              <MenuItem selected={!platform} onClick={() => setPlatform(null)}>
                Любая площадка
              </MenuItem>
              {TENDER_PLATFORMS.map((p) => (
                <MenuItem key={p} selected={platform === p} onClick={() => setPlatform(p)}>
                  {p}
                </MenuItem>
              ))}
            </div>
          </FilterChip>
        </FilterBar>
      </div>

      {isLoading ? (
        <div className="flex gap-2.5 p-6">
          {tenderStatuses.map((s) => (
            <div key={s.id} className="w-[280px] space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Нет тендеров"
          description={
            hasActiveBoardFilters || search
              ? 'По заданным фильтрам ничего не найдено. Измените или сбросьте фильтры.'
              : 'Добавьте первый тендер кнопкой «Тендер» вверху.'
          }
        />
      ) : (
        <KanbanBoard<TenderStatus, Tender>
          statuses={tenderStatuses}
          items={items}
          onCardClick={(t) => navigate({ to: '/tenders/$id', params: { id: t.id } })}
          onCreate={(status) => setCreateStatus(status)}
          onReorder={(updates) => {
            const statusChanged = updates.find((u) => {
              const original = items.find((x) => x.id === u.id);
              return original && original.status !== u.status;
            });
            if (statusChanged && isFinalTenderStatus(statusChanged.status)) {
              const t = items.find((x) => x.id === statusChanged.id);
              setFinalDrop({ id: statusChanged.id, status: statusChanged.status, title: t?.title });
              return;
            }
            reorder.mutate(updates, {
              onSuccess: () => {
                if (statusChanged) {
                  const t = items.find((x) => x.id === statusChanged.id);
                  toast.success(`Тендер «${t?.title}» — статус изменён`);
                }
              },
              onError: () => toast.error('Не удалось изменить порядок'),
            });
          }}
          getAccentColor={(t) => TENDER_LAW_META[t.law].color}
          renderCard={(t) => (
            <TenderKanbanCard
              tender={t}
              accountManager={t.accountManagerId ? userMap.get(t.accountManagerId) : undefined}
            />
          )}
        />
      )}

      <Sheet open={createStatus !== null} onOpenChange={(o) => !o && setCreateStatus(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новый тендер</SheetTitle>
            <SheetDescription>
              Заполните карточку закупки. Статус — колонка, в которую попадёт тендер.
            </SheetDescription>
          </SheetHeader>

          {createStatus !== null && (
            <TenderForm
              onSubmit={handleCreate}
              onCancel={() => setCreateStatus(null)}
              isPending={createTender.isPending}
              submitLabel="Создать тендер"
              defaultValues={
                currentUser?.role === 'account_manager'
                  ? { accountManagerId: currentUser.id }
                  : undefined
              }
            />
          )}
        </SheetContent>
      </Sheet>

      <TenderFinalStatusDialog
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
              onSuccess: (t) => {
                setFinalDrop(null);
                toast.success(`Тендер «${t.title}» — статус изменён`);
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
