import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileSignature,
  GraduationCap,
  Handshake,
  User as UserIcon,
} from 'lucide-react';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import type { KanbanStatusDescriptor } from '@/components/kanban/types';
import type {
  CandidateStatus,
  EmploymentType,
  EngagementType,
  Grade,
} from '@/api/types';
import { candidateStatuses } from '@/mocks/db/candidates';
import { candidatesApi } from '@/api/candidates';
import { useCandidates, useReorderCandidatesKanban, candidateKeys } from './hooks';
import { useUsers } from '@/features/users/hooks';
import { CandidateKanbanCard } from './CandidateKanbanCard';
import { useFiltersStore } from '@/stores/filters';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { ENGAGEMENT_META, ENGAGEMENT_OPTIONS } from '@/lib/engagement';
import { FilterBar, FilterChip, MenuItem } from '@/components/common/FilterChip';

const STATUSES: KanbanStatusDescriptor<CandidateStatus>[] = candidateStatuses;

const GRADE_OPTIONS: Grade[] = ['Junior', 'Middle', 'Senior', 'Lead'];

const EMPLOYMENT_OPTIONS: EmploymentType[] = ['ИП', 'СМЗ', 'ТК РФ'];

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function CandidatesKanbanPage() {
  const navigate = useNavigate();
  const search = useFiltersStore((s) => s.search);
  const grade = useFiltersStore((s) => s.grade);
  const recruiterId = useFiltersStore((s) => s.recruiterId);
  const engagementType = useFiltersStore((s) => s.engagementType);
  const employmentType = useFiltersStore((s) => s.employmentType);
  const setGrade = useFiltersStore((s) => s.setGrade);
  const setRecruiterId = useFiltersStore((s) => s.setRecruiterId);
  const setEngagementType = useFiltersStore((s) => s.setEngagementType);
  const setEmploymentType = useFiltersStore((s) => s.setEmploymentType);
  const resetBoardFilters = useFiltersStore((s) => s.resetBoardFilters);

  const { data, isLoading } = useCandidates({
    search,
    grade: grade ?? undefined,
    recruiterId: recruiterId ?? undefined,
    engagementType: engagementType ?? undefined,
    employmentType: employmentType ?? undefined,
    // На канбан-доску архивированных кандидатов не показываем — они живут
    // в разделе «База кандидатов».
    archived: false,
    // PERF/BUG: дефолтный pageSize=50 на бэке давал баг — при >50 активных
    // кандидатов часть тихо пропадала с доски. Поднимаем потолок до 200:
    // это покрывает реалистичные команды (10 рекрутеров × 20 активных).
    // Для команд побольше следующий шаг — стрим по колонкам/виртуализация.
    pageSize: 200,
  });
  const { data: usersData } = useUsers();
  const reorder = useReorderCandidatesKanban();
  const queryClient = useQueryClient();

  const userMap = useMemo(() => new Map((usersData ?? []).map((u) => [u.id, u])), [usersData]);

  const recruiters = useMemo(
    () =>
      (usersData ?? []).filter(
        (u) => u.role === 'recruiter' || u.role === 'admin' || u.role === 'account_manager',
      ),
    [usersData],
  );

  const items = data?.items ?? [];
  const totalCount = items.length;

  const hasActiveBoardFilters =
    !!grade || !!recruiterId || !!engagementType || !!employmentType;

  const recruiterLabel = recruiterId
    ? userMap.get(recruiterId)?.fullName ?? '—'
    : null;
  const engagementLabel = engagementType
    ? ENGAGEMENT_META[engagementType].label
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-4">
        <FilterBar
          hasActiveFilters={hasActiveBoardFilters}
          onReset={resetBoardFilters}
          rightSlot={
            <span className="tnum text-[11.5px] text-muted-foreground/80">
              {totalCount} {pluralize(totalCount, ['кандидат', 'кандидата', 'кандидатов'])}
            </span>
          }
        >
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
            active={!!employmentType}
            icon={FileSignature}
            label="Оформление"
            value={employmentType}
            onClear={() => setEmploymentType(null)}
          >
            <MenuItem
              selected={!employmentType}
              onClick={() => setEmploymentType(null)}
            >
              Любое оформление
            </MenuItem>
            {EMPLOYMENT_OPTIONS.map((e) => (
              <MenuItem
                key={e}
                selected={employmentType === e}
                onClick={() => setEmploymentType(e)}
              >
                {e}
              </MenuItem>
            ))}
          </FilterChip>
        </FilterBar>
      </div>

      {isLoading ? (
        <div className="flex gap-2.5 p-6">
          {STATUSES.map((s) => (
            <div key={s.id} className="w-[280px] space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Нет кандидатов"
          description={
            hasActiveBoardFilters || search
              ? 'По заданным фильтрам ничего не найдено. Измените или сбросьте фильтры.'
              : 'Добавьте первого кандидата или измените фильтры.'
          }
        />
      ) : (
        <KanbanBoard<CandidateStatus, (typeof items)[number]>
          statuses={STATUSES}
          items={items}
          onCardClick={(c) => navigate({ to: '/candidates/$id', params: { id: c.id } })}
          onCardHover={(c) => {
            // PERF: прогреваем кэш карточки кандидата на hover. К моменту клика
            // данные уже лежат в react-query, открытие карточки — мгновенное.
            queryClient.prefetchQuery({
              queryKey: candidateKeys.byId(c.id),
              queryFn: () => candidatesApi.byId(c.id),
              staleTime: 30_000,
            });
          }}
          onReorder={(updates) => {
            const statusChanged = updates.find((u) => {
              const original = items.find((x) => x.id === u.id);
              return original && original.status !== u.status;
            });
            reorder.mutate(updates, {
              onSuccess: () => {
                if (statusChanged) {
                  const c = items.find((x) => x.id === statusChanged.id);
                  toast.success(`Кандидат «${c?.fullName}» — статус изменён`);
                }
              },
              onError: () => toast.error('Не удалось изменить порядок'),
            });
          }}
          getAccentColor={(c) => ENGAGEMENT_META[c.engagementType].borderColor}
          renderCard={(c) => (
            <CandidateKanbanCard
              candidate={c}
              // recruiterId может быть null (рекрутера отвязали).
              recruiter={c.recruiterId ? userMap.get(c.recruiterId) : undefined}
            />
          )}
        />
      )}
    </div>
  );
}
