import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarDays, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useVacancies } from '@/features/vacancies/hooks';
import { useClients } from '@/features/clients/hooks';
import { useCandidate } from '@/features/candidates/hooks';
import { vacancyStatuses } from '@/mocks/db/vacancies';
import { formatMoneyRub } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useAttachCandidate } from './hooks';
import type { Priority, UUID, Vacancy, VacancyStatus } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: UUID;
  /** ID вакансий, к которым кандидат уже прикреплён — их не показываем в списке */
  excludeIds?: UUID[];
}

// Статусы, которые считаются "активными" для рекрутёра.
const ACTIVE_STATUSES: VacancyStatus[] = ['new', 'in_work', 'proposed', 'interview', 'waiting_os'];

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Срочно',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

function statusColor(status: VacancyStatus) {
  return vacancyStatuses.find((s) => s.id === status)?.color ?? '#94a3b8';
}

function statusLabel(status: VacancyStatus) {
  return vacancyStatuses.find((s) => s.id === status)?.label ?? status;
}

/** Короткая дата вида «15 июн» — компактнее, чем formatDateRu. */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Нормализованный набор технологий — для case-insensitive пересечения. */
function normalizeStack(stack: string[]): Set<string> {
  return new Set(stack.map((s) => s.toLowerCase().trim()));
}

export function AttachVacancyDialog({ open, onOpenChange, candidateId, excludeIds = [] }: Props) {
  const [search, setSearch] = useState('');
  const { data: candidate } = useCandidate(candidateId);
  const { data, isLoading } = useVacancies({ search });
  const { data: clientsData } = useClients();
  const attach = useAttachCandidate();

  const candidateStackSet = useMemo(
    () => normalizeStack(candidate?.stack ?? []),
    [candidate?.stack],
  );

  // Считаем match-скор и сортируем: совпадения → активные → ближе дедлайн → выше приоритет.
  const items = useMemo(() => {
    const excludeSet = new Set(excludeIds);
    const priorityRank: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

    const filtered = (data?.items ?? [])
      .filter((v) => !excludeSet.has(v.id))
      .filter((v) => ACTIVE_STATUSES.includes(v.status))
      .map((v) => {
        const matches = v.stack.filter((s) => candidateStackSet.has(s.toLowerCase().trim()));
        const gradeMatch = candidate?.grade === v.grade;
        const score = matches.length + (gradeMatch ? 0.5 : 0);
        return { vacancy: v, matches, score, gradeMatch };
      });

    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Ближе дедлайн — выше; null дедлайны в самый конец.
      const ad = a.vacancy.deadline ? Date.parse(a.vacancy.deadline) : Infinity;
      const bd = b.vacancy.deadline ? Date.parse(b.vacancy.deadline) : Infinity;
      if (ad !== bd) return ad - bd;
      return priorityRank[a.vacancy.priority] - priorityRank[b.vacancy.priority];
    });

    return filtered;
  }, [data?.items, excludeIds, candidateStackSet, candidate?.grade]);

  const clientName = (id: UUID) => clientsData?.items.find((c) => c.id === id)?.name;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch('');
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl gap-3 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-[15px]">Прикрепить к вакансии</DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5 px-5">
          <Input
            placeholder="Поиск по названию / стеку…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="h-9"
          />
          <div className="flex items-center justify-end text-[11.5px] text-muted-foreground">
            <span className="tnum">
              {items.length} {pluralize(items.length, 'вакансия', 'вакансии', 'вакансий')}
            </span>
          </div>
        </div>

        <div className="max-h-[480px] space-y-1.5 overflow-y-auto px-5 pb-5">
          {isLoading ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Загрузка…</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              {search
                ? 'Ничего не нашли по запросу'
                : 'Активных вакансий нет'}
            </div>
          ) : (
            items.map(({ vacancy: v, matches, gradeMatch }) => (
              <VacancyRow
                key={v.id}
                vacancy={v}
                clientName={clientName(v.clientId)}
                matches={matches}
                candidateStackSet={candidateStackSet}
                gradeMatch={gradeMatch}
                pending={attach.isPending}
                onAttach={() =>
                  attach.mutate(
                    { vacancyId: v.id, candidateId },
                    {
                      onSuccess: () => {
                        toast.success(`Прикреплён к вакансии «${v.title}»`);
                        onOpenChange(false);
                      },
                      onError: () => toast.error('Не удалось прикрепить к вакансии'),
                    },
                  )
                }
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface RowProps {
  vacancy: Vacancy;
  clientName: string | undefined;
  matches: string[];
  candidateStackSet: Set<string>;
  gradeMatch: boolean;
  pending: boolean;
  onAttach: () => void;
}

function VacancyRow({ vacancy, clientName, matches, candidateStackSet, gradeMatch, pending, onAttach }: RowProps) {
  const isInactive = !ACTIVE_STATUSES.includes(vacancy.status);
  const showPriority = vacancy.priority === 'high' || vacancy.priority === 'urgent';
  const deadline = shortDate(vacancy.deadline);
  const matchTotal = vacancy.stack.length;
  const hasMatches = matches.length > 0;

  return (
    <div
      className={cn(
        'group rounded-md border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40',
        isInactive && 'opacity-70',
      )}
    >
      {/* Шапка: статус-точка, заголовок, мета справа */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor(vacancy.status) }}
            title={statusLabel(vacancy.status)}
            aria-label={`Статус: ${statusLabel(vacancy.status)}`}
          />
          <div className="truncate text-[13.5px] font-semibold leading-tight">{vacancy.title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasMatches && (
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium tnum',
                matches.length / Math.max(matchTotal, 1) >= 0.5
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-muted text-muted-foreground',
              )}
              title="Совпадения в стеке с кандидатом"
            >
              {matches.length}/{matchTotal} стек
            </span>
          )}
          {gradeMatch && (
            <span className="inline-flex items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-medium text-indigo-700">
              {vacancy.grade}
            </span>
          )}
          {showPriority && (
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium',
                vacancy.priority === 'urgent'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-amber-50 text-amber-700',
              )}
            >
              {PRIORITY_LABEL[vacancy.priority]}
            </span>
          )}
        </div>
      </div>

      {/* Под-строка: клиент · проект · grade · формат */}
      <div className="mt-1 truncate text-[11.5px] text-muted-foreground">
        {[clientName ?? '—', vacancy.project, vacancy.grade, vacancy.format].filter(Boolean).join(' · ')}
      </div>

      {/* Стек: матчи подсвечены, остальные — приглушённые */}
      {vacancy.stack.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {vacancy.stack.slice(0, 10).map((tech) => {
            const matched = candidateStackSet.has(tech.toLowerCase().trim());
            return (
              <span
                key={tech}
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium leading-4',
                  matched
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {tech}
              </span>
            );
          })}
          {vacancy.stack.length > 10 && (
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium leading-4 text-muted-foreground">
              +{vacancy.stack.length - 10}
            </span>
          )}
        </div>
      )}

      {/* Нижняя мета + кнопка */}
      <div className="mt-2 flex items-center justify-between gap-3 text-[11.5px] text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 tnum">
          <span className="font-medium text-foreground">{formatMoneyRub(vacancy.rateClient)} ₽/ч</span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {vacancy.positions} {pluralize(vacancy.positions, 'позиция', 'позиции', 'позиций')}
            {vacancy.candidatesCount > 0 && (
              <span className="text-muted-foreground/70"> · {vacancy.candidatesCount} прикреплено</span>
            )}
          </span>
          {deadline && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              до {deadline}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 data-[pending=true]:opacity-100"
          data-pending={pending}
          onClick={onAttach}
          disabled={pending}
        >
          Прикрепить
        </Button>
      </div>
    </div>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
