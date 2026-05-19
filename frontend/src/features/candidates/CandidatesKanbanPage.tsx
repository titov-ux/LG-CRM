import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import type { KanbanStatusDescriptor } from '@/components/kanban/types';
import type { CandidateStatus } from '@/api/types';
import { candidateStatuses } from '@/mocks/db/candidates';
import { useCandidates, useChangeCandidateStatus } from './hooks';
import { useUsers } from '@/features/users/hooks';
import { CandidateKanbanCard } from './CandidateKanbanCard';
import { useFiltersStore } from '@/stores/filters';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';

const STATUSES: KanbanStatusDescriptor<CandidateStatus>[] = candidateStatuses;

export function CandidatesKanbanPage() {
  const navigate = useNavigate();
  const search = useFiltersStore((s) => s.search);
  const grade = useFiltersStore((s) => s.grade);
  const recruiterId = useFiltersStore((s) => s.recruiterId);

  const { data, isLoading } = useCandidates({
    search,
    grade: grade ?? undefined,
    recruiterId: recruiterId ?? undefined,
  });
  const { data: usersData } = useUsers();
  const change = useChangeCandidateStatus();

  const userMap = useMemo(() => new Map((usersData ?? []).map((u) => [u.id, u])), [usersData]);

  if (isLoading) {
    return (
      <div className="flex gap-2.5 p-6">
        {STATUSES.map((s) => (
          <div key={s.id} className="w-[280px] space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24" />
          </div>
        ))}
      </div>
    );
  }
  const items = data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState title="Нет кандидатов" description="Добавьте первого кандидата или измените фильтры." />;
  }

  return (
    <KanbanBoard<CandidateStatus, (typeof items)[number]>
      statuses={STATUSES}
      items={items}
      onCardClick={(c) => navigate({ to: '/candidates/$id', params: { id: c.id } })}
      onStatusChange={(id, status) => {
        const c = items.find((x) => x.id === id);
        change.mutate(
          { id, status },
          {
            onSuccess: () => toast.success(`Кандидат «${c?.fullName}» — статус изменён`),
            onError: () => toast.error('Не удалось изменить статус'),
          },
        );
      }}
      renderCard={(c) => <CandidateKanbanCard candidate={c} recruiter={userMap.get(c.recruiterId)} />}
    />
  );
}
