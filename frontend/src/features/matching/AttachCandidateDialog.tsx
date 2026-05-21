import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MapPin, Briefcase } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useCandidates } from '@/features/candidates/hooks';
import { useVacancy } from '@/features/vacancies/hooks';
import { candidateStatuses } from '@/mocks/db/candidates';
import { formatMoneyRub } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useAttachCandidate } from './hooks';
import type { Candidate, CandidateStatus, UUID } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancyId: UUID;
  /** ID кандидатов, которые уже прикреплены — их не показываем в списке */
  excludeIds?: UUID[];
}

// Кого имеет смысл предлагать на вакансию: активные статусы без финальных исходов.
const ACTIVE_STATUSES: CandidateStatus[] = [
  'new',
  'recruiter_iv',
  'ready',
  'presented',
  'waiting_os',
  'offer',
];

// Чем "ближе к презентации" — тем выгоднее предложить.
const STATUS_RANK: Record<CandidateStatus, number> = {
  ready: 0,
  recruiter_iv: 1,
  new: 2,
  presented: 3,
  waiting_os: 4,
  offer: 5,
  rejected_client: 6,
  rejected_candidate: 7,
  reserve: 8,
  hired: 9,
};

function statusColor(status: CandidateStatus) {
  return candidateStatuses.find((s) => s.id === status)?.color ?? '#94a3b8';
}

function statusLabel(status: CandidateStatus) {
  return candidateStatuses.find((s) => s.id === status)?.label ?? status;
}

function initials(fullName: string): string {
  return fullName.split(' ').map((p) => p[0]).slice(0, 2).join('');
}

function yearsPlural(n: number): string {
  return pluralize(n, 'год', 'года', 'лет');
}

function normalizeStack(stack: string[]): Set<string> {
  return new Set(stack.map((s) => s.toLowerCase().trim()));
}

export function AttachCandidateDialog({ open, onOpenChange, vacancyId, excludeIds = [] }: Props) {
  const [search, setSearch] = useState('');
  const { data: vacancy } = useVacancy(vacancyId);
  const { data, isLoading } = useCandidates({ search });
  const attach = useAttachCandidate();

  const vacancyStackSet = useMemo(
    () => normalizeStack(vacancy?.stack ?? []),
    [vacancy?.stack],
  );

  // Скор: совпадения по стеку + бонус за grade + бонус за "горячего".
  // Сортировка: скор → статус (ближе к презентации лучше) → меньше дней в статусе.
  const items = useMemo(() => {
    const excludeSet = new Set(excludeIds);

    const filtered = (data?.items ?? [])
      .filter((c) => !excludeSet.has(c.id))
      .filter((c) => ACTIVE_STATUSES.includes(c.status))
      .map((c) => {
        const matches = c.stack.filter((s) => vacancyStackSet.has(s.toLowerCase().trim()));
        const gradeMatch = vacancy ? c.grade === vacancy.grade : false;
        const score = matches.length + (gradeMatch ? 0.5 : 0);
        return { candidate: c, matches, score, gradeMatch };
      });

    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ra = STATUS_RANK[a.candidate.status] ?? 99;
      const rb = STATUS_RANK[b.candidate.status] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.candidate.daysInStatus - b.candidate.daysInStatus;
    });

    return filtered;
  }, [data?.items, excludeIds, vacancyStackSet, vacancy]);

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
          <DialogTitle className="text-[15px]">Прикрепить кандидата</DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5 px-5">
          <Input
            placeholder="Поиск по имени / стеку…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="h-9"
          />
          <div className="flex items-center justify-end text-[11.5px] text-muted-foreground">
            <span className="tnum">
              {items.length} {pluralize(items.length, 'кандидат', 'кандидата', 'кандидатов')}
            </span>
          </div>
        </div>

        <div className="max-h-[480px] space-y-1.5 overflow-y-auto px-5 pb-5">
          {isLoading ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Загрузка…</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              {search
                ? 'Никого не нашли по этому запросу'
                : 'Активных кандидатов нет'}
            </div>
          ) : (
            items.map(({ candidate: c, matches, gradeMatch }) => (
              <CandidateRow
                key={c.id}
                candidate={c}
                matches={matches}
                vacancyStackSet={vacancyStackSet}
                gradeMatch={gradeMatch}
                pending={attach.isPending}
                onAttach={() =>
                  attach.mutate(
                    { vacancyId, candidateId: c.id },
                    {
                      onSuccess: () => {
                        toast.success(`${c.fullName} прикреплён к вакансии`);
                        onOpenChange(false);
                      },
                      onError: () => toast.error('Не удалось прикрепить кандидата'),
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
  candidate: Candidate;
  matches: string[];
  vacancyStackSet: Set<string>;
  gradeMatch: boolean;
  pending: boolean;
  onAttach: () => void;
}

function CandidateRow({ candidate: c, matches, vacancyStackSet, gradeMatch, pending, onAttach }: RowProps) {
  const isInactive = !ACTIVE_STATUSES.includes(c.status);
  const matchTotal = vacancyStackSet.size;
  const hasMatches = matches.length > 0;
  const matchRatio = matchTotal > 0 ? matches.length / matchTotal : 0;

  return (
    <div
      className={cn(
        'group rounded-md border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40',
        isInactive && 'opacity-70',
      )}
    >
      {/* Шапка: аватар, имя, статус-точка, бейджи справа */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <UserAvatar
            user={{ fullName: c.fullName, initials: initials(c.fullName), color: '#475569' }}
            size={26}
            interactive={false}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: statusColor(c.status) }}
                title={statusLabel(c.status)}
                aria-label={`Статус: ${statusLabel(c.status)}`}
              />
              <span className="truncate text-[13.5px] font-semibold leading-tight">{c.fullName}</span>
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {c.role}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasMatches && (
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium tnum',
                matchRatio >= 0.5
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-muted text-muted-foreground',
              )}
              title="Совпадения по стеку с вакансией"
            >
              {matches.length}/{matchTotal} стек
            </span>
          )}
          {gradeMatch && (
            <span className="inline-flex items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-medium text-indigo-700">
              {c.grade}
            </span>
          )}
        </div>
      </div>

      {/* Под-строка: grade · опыт · локация */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-muted-foreground">
        <span>{c.grade}</span>
        <span className="text-muted-foreground/50">·</span>
        <span>
          {c.experienceYears} {yearsPlural(c.experienceYears)} опыта
        </span>
        {c.location && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {c.location}
            </span>
          </>
        )}
        <span className="text-muted-foreground/50">·</span>
        <span>{statusLabel(c.status)}</span>
      </div>

      {/* Стек: матчи подсвечены */}
      {c.stack.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {c.stack.slice(0, 10).map((tech) => {
            const matched = vacancyStackSet.has(tech.toLowerCase().trim());
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
          {c.stack.length > 10 && (
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium leading-4 text-muted-foreground">
              +{c.stack.length - 10}
            </span>
          )}
        </div>
      )}

      {/* Нижняя мета + кнопка */}
      <div className="mt-2 flex items-center justify-between gap-3 text-[11.5px] text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 tnum">
          <span className="font-medium text-foreground">{formatMoneyRub(c.rate)} ₽/ч</span>
          <span>{c.format}</span>
          {c.source && (
            <span className="inline-flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              {c.source}
            </span>
          )}
          {c.vacancyIds.length > 0 && (
            <span className="text-muted-foreground/70">
              уже на {c.vacancyIds.length}{' '}
              {pluralize(c.vacancyIds.length, 'вакансии', 'вакансиях', 'вакансиях')}
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
