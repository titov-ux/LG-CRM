import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Briefcase,
  Building2,
  Flame,
  GraduationCap,
  Handshake,
  User as UserIcon,
} from 'lucide-react';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import type { KanbanStatusDescriptor } from '@/components/kanban/types';
import type {
  EngagementType,
  Grade,
  Priority,
  VacancyStatus,
} from '@/api/types';
import { vacancyStatuses, isFinalVacancyStatus } from '@/mocks/db/vacancies';
import { vacanciesApi } from '@/api/vacancies';
import {
  useVacancies,
  useReorderVacanciesKanban,
  useChangeVacancyStatus,
  vacancyKeys,
} from './hooks';
import { FinalStatusCommentDialog } from './FinalStatusCommentDialog';
import { useClients } from '@/features/clients/hooks';
import { useUsers } from '@/features/users/hooks';
import { VacancyKanbanCard } from './VacancyKanbanCard';
import { useFiltersStore } from '@/stores/filters';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { ENGAGEMENT_META, ENGAGEMENT_OPTIONS } from '@/lib/engagement';
import { FilterBar, FilterChip, MenuItem } from '@/components/common/FilterChip';

const STATUSES: KanbanStatusDescriptor<VacancyStatus>[] = vacancyStatuses;

const GRADE_OPTIONS: Grade[] = ['Junior', 'Middle', 'Senior', 'Lead'];

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

export function VacanciesKanbanPage() {
  const navigate = useNavigate();
  const search = useFiltersStore((s) => s.search);
  const grade = useFiltersStore((s) => s.grade);
  const priority = useFiltersStore((s) => s.priority);
  const clientId = useFiltersStore((s) => s.clientId);
  const recruiterId = useFiltersStore((s) => s.recruiterId);
  const accountManagerId = useFiltersStore((s) => s.accountManagerId);
  const engagementType = useFiltersStore((s) => s.engagementType);
  const setGrade = useFiltersStore((s) => s.setGrade);
  const setPriority = useFiltersStore((s) => s.setPriority);
  const setClientId = useFiltersStore((s) => s.setClientId);
  const setRecruiterId = useFiltersStore((s) => s.setRecruiterId);
  const setAccountManagerId = useFiltersStore((s) => s.setAccountManagerId);
  const setEngagementType = useFiltersStore((s) => s.setEngagementType);
  const resetBoardFilters = useFiltersStore((s) => s.resetBoardFilters);

  const { data, isLoading } = useVacancies({
    search,
    grade: grade ?? undefined,
    priority: priority ?? undefined,
    clientId: clientId ?? undefined,
    recruiterId: recruiterId ?? undefined,
    accountManagerId: accountManagerId ?? undefined,
    engagementType: engagementType ?? undefined,
    // PERF/BUG: тот же фикс, что и у кандидатского канбана — дефолт pageSize=50
    // тихо обрезал доску при >50 вакансий. 200 покрывает реалистичные нагрузки.
    pageSize: 200,
  });
  const { data: usersData } = useUsers();
  const { data: clientsData } = useClients();
  const reorder = useReorderVacanciesKanban();
  const changeStatus = useChangeVacancyStatus();
  const queryClient = useQueryClient();

  // Перетаскивание в финальную колонку (Закрыта / Закрыта успешно) требует
  // комментарий — копим целевой статус и id вакансии до подтверждения в диалоге.
  const [finalDrop, setFinalDrop] = useState<{ id: string; status: VacancyStatus; title?: string } | null>(
    null,
  );

  const userMap = useMemo(() => new Map((usersData ?? []).map((u) => [u.id, u])), [usersData]);
  const clientMap = useMemo(
    () => new Map((clientsData?.items ?? []).map((c) => [c.id, c])),
    [clientsData],
  );

  const recruiters = useMemo(
    () =>
      (usersData ?? []).filter(
        (u) => u.role === 'recruiter' || u.role === 'admin' || u.role === 'account_manager',
      ),
    [usersData],
  );
  const accountManagers = useMemo(
    () =>
      (usersData ?? []).filter(
        (u) => u.role === 'account_manager' || u.role === 'admin',
      ),
    [usersData],
  );

  const items = data?.items ?? [];
  const totalCount = items.length;

  const hasActiveBoardFilters =
    !!grade ||
    !!priority ||
    !!clientId ||
    !!recruiterId ||
    !!accountManagerId ||
    !!engagementType;

  const clientLabel = clientId ? clientMap.get(clientId)?.name ?? '—' : null;
  const recruiterLabel = recruiterId
    ? userMap.get(recruiterId)?.fullName ?? '—'
    : null;
  const accountManagerLabel = accountManagerId
    ? userMap.get(accountManagerId)?.fullName ?? '—'
    : null;
  const engagementLabel = engagementType
    ? ENGAGEMENT_META[engagementType].label
    : null;
  const priorityLabel = priority ? PRIORITY_LABEL[priority] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-4">
        <FilterBar
          globalSearch
          searchPlaceholder="Поиск вакансий…"
          hasActiveFilters={hasActiveBoardFilters}
          onReset={resetBoardFilters}
          rightSlot={
            <span className="tnum text-[11.5px] text-muted-foreground/80">
              {totalCount} {pluralize(totalCount, ['вакансия', 'вакансии', 'вакансий'])}
            </span>
          }
        >
          <FilterChip
            active={!!accountManagerId}
            icon={Briefcase}
            label="Ответственный"
            value={accountManagerLabel}
            onClear={() => setAccountManagerId(null)}
          >
            <div className="max-h-64 overflow-y-auto">
              <MenuItem
                selected={!accountManagerId}
                onClick={() => setAccountManagerId(null)}
              >
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
            active={!!recruiterId}
            icon={UserIcon}
            label="Рекрутер"
            value={recruiterLabel}
            onClear={() => setRecruiterId(null)}
          >
            <div className="max-h-64 overflow-y-auto">
              <MenuItem
                selected={!recruiterId}
                onClick={() => setRecruiterId(null)}
              >
                Все рекрутеры
              </MenuItem>
              {recruiters.map((u) => (
                <MenuItem
                  key={u.id}
                  selected={recruiterId === u.id}
                  onClick={() => setRecruiterId(u.id)}
                >
                  {u.fullName}
                </MenuItem>
              ))}
            </div>
          </FilterChip>

          <FilterChip
            active={!!grade}
            icon={GraduationCap}
            label="Грейд"
            value={grade}
            onClear={() => setGrade(null)}
          >
            <MenuItem selected={!grade} onClick={() => setGrade(null)}>
              Все грейды
            </MenuItem>
            {GRADE_OPTIONS.map((g) => (
              <MenuItem key={g} selected={grade === g} onClick={() => setGrade(g)}>
                {g}
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
              <MenuItem
                key={p.id}
                selected={priority === p.id}
                onClick={() => setPriority(p.id)}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: p.dot }}
                  />
                  {p.label}
                </span>
              </MenuItem>
            ))}
          </FilterChip>

          <FilterChip
            active={!!engagementType}
            icon={Handshake}
            label="Тип сделки"
            value={engagementLabel}
            onClear={() => setEngagementType(null)}
          >
            <MenuItem
              selected={!engagementType}
              onClick={() => setEngagementType(null)}
            >
              Любой тип
            </MenuItem>
            {ENGAGEMENT_OPTIONS.map((e) => (
              <MenuItem
                key={e.id}
                selected={engagementType === e.id}
                onClick={() => setEngagementType(e.id as EngagementType)}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: ENGAGEMENT_META[e.id].borderColor }}
                  />
                  {e.label}
                </span>
              </MenuItem>
            ))}
          </FilterChip>

          <FilterChip
            active={!!clientId}
            icon={Building2}
            label="Клиент"
            value={clientLabel}
            onClear={() => setClientId(null)}
          >
            <div className="max-h-64 overflow-y-auto">
              <MenuItem selected={!clientId} onClick={() => setClientId(null)}>
                Все клиенты
              </MenuItem>
              {(clientsData?.items ?? []).map((c) => (
                <MenuItem
                  key={c.id}
                  selected={clientId === c.id}
                  onClick={() => setClientId(c.id)}
                >
                  {c.name}
                </MenuItem>
              ))}
            </div>
          </FilterChip>
        </FilterBar>
      </div>

      {isLoading ? (
        <div className="flex gap-2.5 p-6">
          {STATUSES.map((s) => (
            <div key={s.id} className="w-[280px] space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Нет вакансий"
          description={
            hasActiveBoardFilters || search
              ? 'По заданным фильтрам ничего не найдено. Измените или сбросьте фильтры.'
              : 'Создайте первую вакансию или измените фильтры.'
          }
        />
      ) : (
        <KanbanBoard<VacancyStatus, (typeof items)[number]>
          statuses={STATUSES}
          items={items}
          onCardClick={(v) => navigate({ to: '/vacancies/$id', params: { id: v.id } })}
          onCardHover={(v) => {
            // PERF: прогрев кэша карточки вакансии на hover. Карточка тяжёлая
            // (вакансия + activity + кандидаты), prefetch экономит видимый latency.
            queryClient.prefetchQuery({
              queryKey: vacancyKeys.byId(v.id),
              queryFn: () => vacanciesApi.byId(v.id),
              staleTime: 30_000,
            });
          }}
          onReorder={(updates) => {
            const statusChanged = updates.find((u) => {
              const original = items.find((x) => x.id === u.id);
              return original && original.status !== u.status;
            });
            // Финальный статус требует комментария и недоступен через
            // reorder-эндпоинт — открываем диалог и идём через change_status.
            if (statusChanged && isFinalVacancyStatus(statusChanged.status)) {
              const v = items.find((x) => x.id === statusChanged.id);
              setFinalDrop({ id: statusChanged.id, status: statusChanged.status, title: v?.title });
              return;
            }
            reorder.mutate(updates, {
              onSuccess: () => {
                if (statusChanged) {
                  const v = items.find((x) => x.id === statusChanged.id);
                  toast.success(`Вакансия «${v?.title}» — статус изменён`);
                }
              },
              onError: () => toast.error('Не удалось изменить порядок'),
            });
          }}
          getAccentColor={(v) => ENGAGEMENT_META[v.engagementType].borderColor}
          renderCard={(v) => (
            <VacancyKanbanCard
              vacancy={v}
              clientName={clientMap.get(v.clientId)?.name}
              recruiters={v.recruiterIds.map((id) => userMap.get(id)).filter(Boolean) as never[]}
            />
          )}
        />
      )}

      <FinalStatusCommentDialog
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
              onSuccess: (v) => {
                setFinalDrop(null);
                toast.success(`Вакансия «${v.title}» — статус изменён`);
              },
              onError: () => toast.error('Не удалось изменить статус'),
            },
          );
        }}
      />
    </div>
  );
}
