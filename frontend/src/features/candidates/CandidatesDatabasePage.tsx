import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSignature,
  GraduationCap,
  Handshake,
  Inbox,
  Layers,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FilterBar, FilterChip, MenuItem } from '@/components/common/FilterChip';
import { UserAvatar } from '@/components/common/UserAvatar';
import { EngagementBadge } from '@/components/common/EngagementBadge';
import { StackTags } from '@/components/common/StackTags';
import { DaysBadge } from '@/components/common/DaysBadge';
import { useFiltersStore } from '@/stores/filters';
import { useUsers } from '@/features/users/hooks';
import { ENGAGEMENT_META, ENGAGEMENT_OPTIONS } from '@/lib/engagement';
import { candidateStatuses } from '@/mocks/db/candidates';
import { cn } from '@/lib/utils';
import type {
  Candidate,
  CandidateStatus,
  EmploymentType,
  EngagementType,
  Grade,
} from '@/api/types';
import { useCandidates, useDeleteCandidatePermanent, useRestoreCandidate } from './hooks';
import { useCan } from '@/lib/permissions';

const GRADE_OPTIONS: Grade[] = ['Junior', 'Middle', 'Senior', 'Lead'];
const EMPLOYMENT_OPTIONS: EmploymentType[] = ['ИП', 'СМЗ', 'ТК РФ'];

type Scope = 'all' | 'active' | 'archived';

interface ScopeOption {
  id: Scope;
  label: string;
  hint: string;
}

const SCOPE_OPTIONS: ScopeOption[] = [
  { id: 'all', label: 'Все', hint: 'И на доске, и в архиве' },
  { id: 'active', label: 'На доске', hint: 'Активные кандидаты' },
  { id: 'archived', label: 'Архив', hint: 'Убраны с доски, остались в базе' },
];

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

function statusMeta(id: CandidateStatus) {
  return candidateStatuses.find((s) => s.id === id);
}

// Максимум кандидатов на одну страницу. Если их больше — внизу появятся
// кнопки пагинации. Хардкод обоснован: бэк по-умолчанию pageSize=50, мы хотим
// «потолще» для базы, но не больше 100 — иначе таблица становится тяжёлой.
const PAGE_SIZE = 100;

// Локальный стейт скоупа (Все/На доске/Архив) — остаётся внутри страницы;
// остальные фильтры читаем из общего useFiltersStore, чтобы они
// синхронизировались с канбан-доской.

export function CandidatesDatabasePage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>('all');
  const [page, setPage] = useState(1);
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

  const archivedParam =
    scope === 'all' ? 'all' : scope === 'archived' ? true : false;

  // При смене любого фильтра/скоупа/поиска возвращаемся на первую страницу —
  // иначе можно очутиться на пустой 3-й странице после ужесточения фильтра.
  useEffect(() => {
    setPage(1);
  }, [scope, search, grade, recruiterId, engagementType, employmentType]);

  const { data, isLoading } = useCandidates({
    search,
    grade: grade ?? undefined,
    recruiterId: recruiterId ?? undefined,
    engagementType: engagementType ?? undefined,
    employmentType: employmentType ?? undefined,
    archived: archivedParam,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: usersData } = useUsers();
  const restoreCandidate = useRestoreCandidate();
  const deleteCandidatePermanent = useDeleteCandidatePermanent();
  const canDeletePermanent = useCan('candidate:delete_permanent');
  // Кандидат под удаление держим в локальном state, чтобы диалог был один
  // на всю страницу — без рендера N модалок в TableBody.
  const [pendingDelete, setPendingDelete] = useState<Candidate | null>(null);

  // Если после удаления/архивирования текущая страница оказалась пустой,
  // а на предыдущих ещё что-то есть — мягко откатываемся назад.
  useEffect(() => {
    if (!data) return;
    if (data.items.length === 0 && data.total > 0 && page > 1) {
      setPage((p) => Math.max(1, p - 1));
    }
  }, [data, page]);

  const userMap = useMemo(
    () => new Map((usersData ?? []).map((u) => [u.id, u])),
    [usersData],
  );
  const recruiters = useMemo(
    () =>
      (usersData ?? []).filter(
        (u) => u.role === 'recruiter' || u.role === 'admin' || u.role === 'account_manager',
      ),
    [usersData],
  );

  const items = data?.items ?? [];
  // Общее количество с учётом фильтров и скоупа (вычисляется на бэке).
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const hasActiveBoardFilters =
    !!grade || !!recruiterId || !!engagementType || !!employmentType;

  const recruiterLabel = recruiterId
    ? userMap.get(recruiterId)?.fullName ?? '—'
    : null;
  const engagementLabel = engagementType
    ? ENGAGEMENT_META[engagementType].label
    : null;

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
      {/* Пиллы выбора скоупа: «Все / На доске / Архив». Счётчик внутри
          пиллы показывается только у активного скоупа — это его общий total
          (с учётом фильтров). Для остальных скоупов пришлось бы делать
          доп. запросы, и в Notion-стиле визуально аккуратнее без них. */}
      <div className="mb-4 inline-flex rounded-lg border bg-muted/40 p-0.5">
        {SCOPE_OPTIONS.map((opt) => {
          const isActive = scope === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setScope(opt.id)}
              className={cn(
                'group inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title={opt.hint}
            >
              {opt.id === 'active' && <Layers className="h-3.5 w-3.5" />}
              {opt.id === 'archived' && <Inbox className="h-3.5 w-3.5" />}
              {opt.id === 'all' && <Database className="h-3.5 w-3.5" />}
              {opt.label}
              {isActive && (
                <span className="tnum rounded bg-muted px-1.5 text-[10.5px] font-semibold text-foreground/80">
                  {isLoading ? '…' : total}
                </span>
              )}
            </button>
          );
        })}
      </div>

        <FilterBar
          hasActiveFilters={hasActiveBoardFilters}
          onReset={resetBoardFilters}
          rightSlot={
            <span className="tnum text-[11.5px] text-muted-foreground/80">
              {total > PAGE_SIZE
                ? `${rangeStart}–${rangeEnd} из ${total}`
                : `${total} ${pluralize(total, ['кандидат', 'кандидата', 'кандидатов'])}`}
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
              <MenuItem selected={!recruiterId} onClick={() => setRecruiterId(null)}>
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

        {/* Notion-стиль таблица: лёгкие границы, разрежённые строки, прозрачный
            фон, шапка таблицы — узкая, мягкая. */}
        <Card className="overflow-hidden border-border/70 shadow-none">
          <Table>
            <TableHeader>
              <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  Кандидат
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  Тип
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  Стек
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  Статус
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  Рекрутер
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  В статусе
                </TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6" />
                    </TableCell>
                  </TableRow>
                ))}

              {!isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-14 text-center text-[13px] text-muted-foreground"
                  >
                    {scope === 'archived'
                      ? 'В архиве пока никого нет — никто ещё не убирался с доски.'
                      : 'По заданным фильтрам никого не нашлось.'}
                  </TableCell>
                </TableRow>
              )}

              {!isLoading &&
                items.map((c) => {
                  // recruiterId может быть null (рекрутера отвязали) — тогда recruiter = undefined.
                  const recruiter = c.recruiterId ? userMap.get(c.recruiterId) : undefined;
                  const meta = statusMeta(c.status);
                  // Покажем первые 3 элемента стека + «+N» как фолбэк под Notion-стиль.
                  return (
                    <TableRow
                      key={c.id}
                      className={cn(
                        'group cursor-pointer border-b border-border/60 transition-colors',
                        c.archived
                          ? 'bg-amber-50/30 hover:bg-amber-50/60 dark:bg-amber-950/10 dark:hover:bg-amber-950/20'
                          : 'hover:bg-muted/40',
                      )}
                      onClick={() =>
                        navigate({ to: '/database/$id', params: { id: c.id } })
                      }
                    >
                      <TableCell className="py-2.5 align-top">
                        <div className="flex items-start gap-2.5">
                          <UserAvatar
                            user={{
                              fullName: c.fullName,
                              initials: c.fullName
                                .split(' ')
                                .map((p) => p[0])
                                .slice(0, 2)
                                .join(''),
                              color: c.archived ? '#a8a29e' : '#475569',
                            }}
                            size={28}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'truncate text-[13.5px] font-semibold leading-tight',
                                  c.archived && 'text-muted-foreground',
                                )}
                              >
                                {c.fullName}
                              </span>
                              {c.archived && (
                                <span
                                  className="inline-flex items-center gap-1 rounded border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                                  title={
                                    c.archivedAt
                                      ? `Убран ${new Date(c.archivedAt).toLocaleDateString('ru-RU')}`
                                      : 'Убран с доски'
                                  }
                                >
                                  <Inbox className="h-2.5 w-2.5" />
                                  Архив
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                              {c.role} · {c.grade}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        <EngagementBadge type={c.engagementType} variant="chip" />
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        <StackTags stack={c.stack} max={3} variant="accent" />
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        <span className="inline-flex items-center gap-1.5 text-[12.5px]">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: meta?.color ?? '#94a3b8' }}
                          />
                          {meta?.label ?? c.status}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        {recruiter ? (
                          <span className="inline-flex items-center gap-1.5 text-[12.5px]">
                            <UserAvatar user={recruiter} size={20} />
                            <span className="truncate">{recruiter.fullName}</span>
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        {c.archived ? (
                          <span className="text-[12px] text-muted-foreground">
                            {c.archivedAt
                              ? new Date(c.archivedAt).toLocaleDateString('ru-RU')
                              : '—'}
                          </span>
                        ) : (
                          <DaysBadge days={c.daysInStatus} />
                        )}
                      </TableCell>
                      <TableCell
                        className="py-2.5 text-right align-top"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          {c.archived && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-[11.5px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                              onClick={() =>
                                restoreCandidate.mutate(c.id, {
                                  onSuccess: () =>
                                    toast.success(`«${c.fullName}» возвращён на доску`),
                                  onError: () =>
                                    toast.error('Не удалось восстановить кандидата'),
                                })
                              }
                              disabled={restoreCandidate.isPending}
                              title="Вернуть на канбан-доску"
                            >
                              <ArchiveRestore className="h-3 w-3" />
                              Вернуть
                            </Button>
                          )}
                          {canDeletePermanent && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                              onClick={() => setPendingDelete(c)}
                              disabled={deleteCandidatePermanent.isPending}
                              aria-label={`Удалить «${c.fullName}» из базы`}
                              title="Удалить из базы"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </Card>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-[12px] text-muted-foreground">
            <span className="tnum">
              Показано <span className="font-medium text-foreground">{rangeStart}–{rangeEnd}</span>{' '}
              из <span className="font-medium text-foreground">{total}</span>
            </span>
            <div className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[12px]"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Назад
              </Button>
              <span className="tnum px-2 text-[12px]">
                Стр. <span className="font-medium text-foreground">{page}</span> из{' '}
                <span className="font-medium text-foreground">{totalPages}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[12px]"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Вперёд
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Подтверждение полного удаления. Один диалог на всю страницу —
            конкретный кандидат хранится в `pendingDelete`. Закрытие во
            время мутации блокируем, чтобы не было гонок. */}
        <Dialog
          open={pendingDelete !== null}
          onOpenChange={(o) => {
            if (deleteCandidatePermanent.isPending) return;
            if (!o) setPendingDelete(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Удалить кандидата из базы?</DialogTitle>
              <DialogDescription>
                {pendingDelete && (
                  <>
                    Кандидат «
                    <span className="font-medium text-foreground">{pendingDelete.fullName}</span>
                    » будет удалён без возможности восстановления — вместе с историей
                    смены статусов, комментариями и привязками к вакансиям.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => setPendingDelete(null)}
                disabled={deleteCandidatePermanent.isPending}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!pendingDelete) return;
                  const target = pendingDelete;
                  deleteCandidatePermanent.mutate(target.id, {
                    onSuccess: () => {
                      toast.success(`Кандидат «${target.fullName}» удалён из базы`);
                      setPendingDelete(null);
                    },
                    onError: () => toast.error('Не удалось удалить кандидата из базы'),
                  });
                }}
                disabled={deleteCandidatePermanent.isPending}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {deleteCandidatePermanent.isPending ? 'Удаление…' : 'Удалить навсегда'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
