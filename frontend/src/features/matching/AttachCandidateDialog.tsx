import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MapPin, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/common/UserAvatar';
import { EngagementBadge } from '@/components/common/EngagementBadge';
import { useCandidates } from '@/features/candidates/hooks';
import { useVacancy } from '@/features/vacancies/hooks';
import { candidateStatuses } from '@/mocks/db/candidates';
import { formatMoneyRub } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { engagementLabel } from '@/lib/engagement';
import { useAttachCandidate } from './hooks';
import { MarginBadge } from './MarginBadge';
import {
  DEFAULT_HOURS_PER_MONTH,
  candidateSalaryExceedsVacancyMax,
  pairSupportsMargin,
} from '@/lib/compensation';
import type { Candidate, CandidateStatus, UUID, Vacancy } from '@/api/types';

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

function readSavedHoursPerMonth(): number {
  if (typeof window === 'undefined') return DEFAULT_HOURS_PER_MONTH;
  const raw = window.localStorage.getItem('crm:hoursPerMonth');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HOURS_PER_MONTH;
}

export function AttachCandidateDialog({ open, onOpenChange, vacancyId, excludeIds = [] }: Props) {
  const [search, setSearch] = useState('');
  // По умолчанию скрываем кандидатов другого типа — в 99% случаев это нужное поведение.
  // Тумблер позволяет рекрутеру при необходимости увидеть всех (например, чтобы понять,
  // почему «ожидаемого» кандидата нет в списке).
  const [showAllTypes, setShowAllTypes] = useState(false);
  // Кандидат, для которого оклад выше «Оклад до» по агентской вакансии — ждём подтверждения.
  // null = диалог подтверждения закрыт.
  const [salaryConfirmFor, setSalaryConfirmFor] = useState<Candidate | null>(null);
  const { data: vacancy } = useVacancy(vacancyId);
  const { data, isLoading } = useCandidates({ search });
  const attach = useAttachCandidate();
  // Часы в месяц настраиваются в карточке вакансии и хранятся в localStorage.
  // Здесь читаем значение каждый раз, когда диалог открывается заново.
  const hoursPerMonth = useMemo(() => (open ? readSavedHoursPerMonth() : DEFAULT_HOURS_PER_MONTH), [open]);

  const vacancyStackSet = useMemo(
    () => normalizeStack(vacancy?.stack ?? []),
    [vacancy?.stack],
  );

  // Скор: совпадения по стеку + бонус за grade + бонус за "горячего".
  // Сортировка: совпадение по типу сделки → скор → статус → меньше дней в статусе.
  const items = useMemo(() => {
    const excludeSet = new Set(excludeIds);

    const filtered = (data?.items ?? [])
      .filter((c) => !excludeSet.has(c.id))
      .filter((c) => ACTIVE_STATUSES.includes(c.status))
      .filter((c) => showAllTypes || !vacancy || c.engagementType === vacancy.engagementType)
      .map((c) => {
        const matches = c.stack.filter((s) => vacancyStackSet.has(s.toLowerCase().trim()));
        const gradeMatch = vacancy ? c.grade === vacancy.grade : false;
        const score = matches.length + (gradeMatch ? 0.5 : 0);
        const typeMismatch = !!vacancy && c.engagementType !== vacancy.engagementType;
        return { candidate: c, matches, score, gradeMatch, typeMismatch };
      });

    filtered.sort((a, b) => {
      // Сначала совпадающие по типу — несовпадающие в самый низ.
      if (a.typeMismatch !== b.typeMismatch) return a.typeMismatch ? 1 : -1;
      if (b.score !== a.score) return b.score - a.score;
      const ra = STATUS_RANK[a.candidate.status] ?? 99;
      const rb = STATUS_RANK[b.candidate.status] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.candidate.daysInStatus - b.candidate.daysInStatus;
    });

    return filtered;
  }, [data?.items, excludeIds, vacancyStackSet, vacancy, showAllTypes]);

  const hiddenByTypeCount = useMemo(() => {
    if (!vacancy || showAllTypes) return 0;
    return (data?.items ?? [])
      .filter((c) => !excludeIds.includes(c.id))
      .filter((c) => ACTIVE_STATUSES.includes(c.status))
      .filter((c) => c.engagementType !== vacancy.engagementType).length;
  }, [data?.items, excludeIds, vacancy, showAllTypes]);

  // Выполняем привязку (используется и из обычного клика, и из confirm-диалога).
  const runAttach = (candidate: Candidate) => {
    attach.mutate(
      { vacancyId, candidateId: candidate.id },
      {
        onSuccess: () => {
          toast.success(`${candidate.fullName} прикреплён к вакансии`);
          setSalaryConfirmFor(null);
          onOpenChange(false);
        },
        onError: () => toast.error('Не удалось прикрепить кандидата'),
      },
    );
  };

  // Клик по «Прикрепить»: для агентской вакансии с превышением оклада сначала
  // спрашиваем подтверждение, в остальных случаях привязываем сразу.
  const handleAttachClick = (candidate: Candidate) => {
    if (vacancy && candidateSalaryExceedsVacancyMax(vacancy, candidate)) {
      setSalaryConfirmFor(candidate);
      return;
    }
    runAttach(candidate);
  };

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
          <DialogTitle className="text-[15px]">
            Прикрепить кандидата
            {vacancy && (
              <span className="ml-2 align-middle">
                <EngagementBadge type={vacancy.engagementType} variant="chip" />
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5 px-5">
          <Input
            placeholder="Поиск по имени / стеку…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="h-9"
          />
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <Switch checked={showAllTypes} onCheckedChange={setShowAllTypes} />
              <span>
                Показать все типы
                {hiddenByTypeCount > 0 && !showAllTypes && (
                  <span className="ml-1 text-muted-foreground/70">
                    (скрыто {hiddenByTypeCount})
                  </span>
                )}
              </span>
            </label>
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
            <TooltipProvider delayDuration={150}>
              {items.map(({ candidate: c, matches, gradeMatch, typeMismatch }) => (
                <CandidateRow
                  key={c.id}
                  candidate={c}
                  vacancy={vacancy}
                  hoursPerMonth={hoursPerMonth}
                  matches={matches}
                  vacancyStackSet={vacancyStackSet}
                  gradeMatch={gradeMatch}
                  typeMismatch={typeMismatch}
                  salaryExceeded={!!vacancy && candidateSalaryExceedsVacancyMax(vacancy, c)}
                  pending={attach.isPending}
                  onAttach={() => handleAttachClick(c)}
                />
              ))}
            </TooltipProvider>
          )}
        </div>
      </DialogContent>

      {/* Подтверждение: оклад кандидата выше «Оклад до» по агентской вакансии. */}
      <SalaryExceedConfirmDialog
        candidate={salaryConfirmFor}
        vacancy={vacancy}
        pending={attach.isPending}
        onCancel={() => setSalaryConfirmFor(null)}
        onConfirm={() => {
          if (salaryConfirmFor) runAttach(salaryConfirmFor);
        }}
      />
    </Dialog>
  );
}

interface SalaryConfirmProps {
  candidate: Candidate | null;
  vacancy: Vacancy | undefined;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Подтверждение прикрепления, когда rateMonth кандидата выше salaryMax вакансии.
 * Используем обычный Dialog (AlertDialog в проекте не подключён) с акцентной кнопкой
 * подтверждения — рекрутер может осознанно перебить ограничение.
 */
function SalaryExceedConfirmDialog({
  candidate,
  vacancy,
  pending,
  onCancel,
  onConfirm,
}: SalaryConfirmProps) {
  const open = !!candidate && !!vacancy && vacancy.salaryMax != null;
  if (!candidate || !vacancy || vacancy.salaryMax == null) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
        <DialogContent className="max-w-sm" />
      </Dialog>
    );
  }
  const diff = candidate.rateMonth - vacancy.salaryMax;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Оклад кандидата выше «Оклад до»
          </DialogTitle>
          <DialogDescription className="pt-1 text-[13px]">
            Ожидаемый оклад{' '}
            <span className="font-medium text-foreground">{candidate.fullName}</span> —{' '}
            <span className="font-medium text-foreground tnum">
              {formatMoneyRub(candidate.rateMonth)} ₽/мес
            </span>
            , что выше «Оклад до» по вакансии (
            <span className="font-medium text-foreground tnum">
              {formatMoneyRub(vacancy.salaryMax)} ₽/мес
            </span>
            ) на{' '}
            <span className="font-medium text-amber-700 tnum">
              {formatMoneyRub(diff)} ₽
            </span>
            . Точно прикрепить?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={pending}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            Всё равно прикрепить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RowProps {
  candidate: Candidate;
  vacancy: Vacancy | undefined;
  hoursPerMonth: number;
  matches: string[];
  vacancyStackSet: Set<string>;
  gradeMatch: boolean;
  typeMismatch: boolean;
  /** Оклад кандидата выше «Оклад до» по агентской вакансии. */
  salaryExceeded: boolean;
  pending: boolean;
  onAttach: () => void;
}

function CandidateRow({
  candidate: c,
  vacancy,
  hoursPerMonth,
  matches,
  vacancyStackSet,
  gradeMatch,
  typeMismatch,
  salaryExceeded,
  pending,
  onAttach,
}: RowProps) {
  const isInactive = !ACTIVE_STATUSES.includes(c.status);
  const matchTotal = vacancyStackSet.size;
  const hasMatches = matches.length > 0;
  const matchRatio = matchTotal > 0 ? matches.length / matchTotal : 0;
  const blocked = typeMismatch;

  return (
    <div
      className={cn(
        'group rounded-md border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40',
        isInactive && 'opacity-70',
        blocked && 'opacity-60',
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
          <EngagementBadge type={c.engagementType} />
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
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 tnum">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            {formatMoneyRub(c.rateMonth)} ₽/мес
            {vacancy && pairSupportsMargin(vacancy, c) && (
              <MarginBadge
                vacancy={vacancy}
                candidate={c}
                hoursPerMonth={hoursPerMonth}
                size="sm"
              />
            )}
            {salaryExceeded && vacancy?.salaryMax != null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium leading-4 text-amber-700 ring-1 ring-inset ring-amber-200/70"
                    tabIndex={0}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Оклад выше
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Ожидаемый оклад {formatMoneyRub(c.rateMonth)} ₽/мес выше «Оклад до»{' '}
                  {formatMoneyRub(vacancy.salaryMax)} ₽/мес по вакансии.
                </TooltipContent>
              </Tooltip>
            )}
          </span>
          <span>{c.employmentType}</span>
          <span>{c.format}</span>
          {c.vacancyIds.length > 0 && (
            <span className="text-muted-foreground/70">
              уже на {c.vacancyIds.length}{' '}
              {pluralize(c.vacancyIds.length, 'вакансии', 'вакансиях', 'вакансиях')}
            </span>
          )}
        </div>
        {blocked && vacancy ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs opacity-100"
                  disabled
                >
                  Прикрепить
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">
              Тип кандидата ({engagementLabel(c.engagementType)}) не совпадает с типом вакансии (
              {engagementLabel(vacancy.engagementType)}).
            </TooltipContent>
          </Tooltip>
        ) : (
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
        )}
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
