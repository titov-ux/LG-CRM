import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import type { KanbanStatusDescriptor } from '@/components/kanban/types';
import type { VacancyStatus } from '@/api/types';
import { vacancyStatuses } from '@/mocks/db/vacancies';
import { useVacancies, useChangeVacancyStatus } from './hooks';
import { useClients } from '@/features/clients/hooks';
import { useUsers } from '@/features/users/hooks';
import { VacancyKanbanCard } from './VacancyKanbanCard';
import { useFiltersStore } from '@/stores/filters';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';

const STATUSES: KanbanStatusDescriptor<VacancyStatus>[] = vacancyStatuses;

export function VacanciesKanbanPage() {
  const navigate = useNavigate();
  const search = useFiltersStore((s) => s.search);
  const grade = useFiltersStore((s) => s.grade);
  const priority = useFiltersStore((s) => s.priority);
  const clientId = useFiltersStore((s) => s.clientId);
  const recruiterId = useFiltersStore((s) => s.recruiterId);

  const { data, isLoading } = useVacancies({
    search,
    grade: grade ?? undefined,
    priority: priority ?? undefined,
    clientId: clientId ?? undefined,
    recruiterId: recruiterId ?? undefined,
  });
  const { data: usersData } = useUsers();
  const { data: clientsData } = useClients();
  const change = useChangeVacancyStatus();

  const userMap = useMemo(() => new Map((usersData ?? []).map((u) => [u.id, u])), [usersData]);
  const clientMap = useMemo(() => new Map((clientsData?.items ?? []).map((c) => [c.id, c])), [clientsData]);

  if (isLoading) {
    return (
      <div className="flex gap-2.5 p-6">
        {STATUSES.map((s) => (
          <div key={s.id} className="w-[280px] space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ))}
      </div>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState title="Нет вакансий" description="Создайте первую вакансию или измените фильтры." />;
  }

  return (
    <KanbanBoard<VacancyStatus, (typeof items)[number]>
      statuses={STATUSES}
      items={items}
      onCardClick={(v) => navigate({ to: '/vacancies/$id', params: { id: v.id } })}
      onStatusChange={(id, status) => {
        const v = items.find((x) => x.id === id);
        change.mutate(
          { id, status },
          {
            onSuccess: () => toast.success(`Вакансия «${v?.title}» — статус изменён`),
            onError: () => toast.error('Не удалось изменить статус'),
          },
        );
      }}
      renderCard={(v) => (
        <VacancyKanbanCard
          vacancy={v}
          clientName={clientMap.get(v.clientId)?.name}
          recruiters={v.recruiterIds.map((id) => userMap.get(id)).filter(Boolean) as never[]}
        />
      )}
    />
  );
}
