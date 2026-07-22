import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import type {
  MatchStatus,
  WeeklySubmissionItem,
  WeeklyUserCount,
  WeeklyVacancyItem,
} from '@/api/analytics';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { vacancyStatuses } from '@/mocks/db/vacancies';
import { useWeeklyActivity } from './hooks';

/**
 * «Итоги недели» на дашборде: сколько вакансий появилось за рабочую неделю
 * и какие кандидаты поданы. Каждая строка кликабельна — переход в карточку
 * вакансии/кандидата. Неделя листается стрелками независимо от глобального
 * периода дашборда.
 */

const MATCH_STATUS_META: Record<MatchStatus, { label: string; className: string }> = {
  submitted: { label: 'Подан', className: 'text-sky-600 dark:text-sky-400' },
  reviewed: { label: 'Просмотрен', className: 'text-violet-600 dark:text-violet-400' },
  interview: { label: 'Интервью', className: 'text-purple-600 dark:text-purple-400' },
  offered: { label: 'Оффер', className: 'text-amber-600 dark:text-amber-400' },
  accepted: { label: 'Принят', className: 'text-emerald-600 dark:text-emerald-400' },
  rejected_client: { label: 'Отказ клиента', className: 'text-rose-600 dark:text-rose-400' },
  rejected_internal: { label: 'Отказ (внутр.)', className: 'text-rose-600 dark:text-rose-400' },
};

interface WeekWindow {
  /** ISO, понедельник 00:00 локального времени. Inclusive. */
  from: string;
  /** ISO, следующий понедельник 00:00. Exclusive. */
  to: string;
  /** «21 — 27 июл» */
  label: string;
}

function resolveWeek(offset: number, now: Date = new Date()): WeekWindow {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const dow = (day.getDay() + 6) % 7; // 0 = понедельник
  const monday = new Date(day.getTime() - dow * 86400_000 + offset * 7 * 86400_000);
  const nextMonday = new Date(monday.getTime() + 7 * 86400_000);
  const sunday = new Date(nextMonday.getTime() - 86400_000);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const label = `${format(monday, sameMonth ? 'd' : 'd MMM', { locale: ru })} — ${format(sunday, 'd MMM', { locale: ru })}`;
  return { from: monday.toISOString(), to: nextMonday.toISOString(), label };
}

export function WeeklyActivityCard() {
  const [offset, setOffset] = useState(0);
  const week = useMemo(() => resolveWeek(offset), [offset]);
  const { data, isLoading } = useWeeklyActivity({ from: week.from, to: week.to });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle>Итоги недели</CardTitle>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Новые вакансии и поданные кандидаты за рабочую неделю.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {offset < 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11.5px] text-muted-foreground"
              onClick={() => setOffset(0)}
            >
              Текущая
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label="Предыдущая неделя"
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="tnum min-w-[96px] text-center text-[12px] font-medium">
            {week.label}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label="Следующая неделя"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <VacanciesBlock items={data.newVacancies.items} total={data.newVacancies.total} />
              <SubmissionsBlock
                items={data.submittedCandidates.items}
                total={data.submittedCandidates.total}
              />
            </div>

            {/* Разбивка по сотрудникам */}
            {(data.byManagers.length > 0 || data.byRecruiters.length > 0) && (
              <div className="grid grid-cols-1 gap-4 border-t pt-3 lg:grid-cols-2">
                <BreakdownBlock
                  icon={Users}
                  iconClass="text-sky-500"
                  barClass="bg-sky-500/70"
                  label="Вакансии по аккаунтам"
                  items={data.byManagers}
                />
                <BreakdownBlock
                  icon={UserCheck}
                  iconClass="text-emerald-500"
                  barClass="bg-emerald-500/70"
                  label="Подачи по рекрутерам"
                  items={data.byRecruiters}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BlockHeader({
  icon: Icon,
  label,
  total,
  iconClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  total: number;
  iconClass: string;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <Icon className={cn('h-3.5 w-3.5', iconClass)} />
      <span className="text-[11.5px] font-semibold">{label}</span>
      <span className="tnum ml-auto text-[16px] font-bold leading-none">{total}</span>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-4 text-center text-[11.5px] text-muted-foreground">
      {text}
    </div>
  );
}

function BreakdownBlock({
  icon: Icon,
  iconClass,
  barClass,
  label,
  items,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  barClass: string;
  label: string;
  items: WeeklyUserCount[];
}) {
  if (items.length === 0) {
    return (
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Icon className={cn('h-3.5 w-3.5', iconClass)} />
          <span className="text-[11.5px] font-semibold">{label}</span>
        </div>
        <EmptyRow text="За эту неделю пусто" />
      </div>
    );
  }
  const max = Math.max(1, ...items.map((i) => i.count));
  const total = items.reduce((sum, i) => sum + i.count, 0);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', iconClass)} />
        <span className="text-[11.5px] font-semibold">{label}</span>
        <span className="tnum ml-auto text-[16px] font-bold leading-none">{total}</span>
      </div>
      <div className="space-y-1">
        {items.map((row, i) => (
          <div
            key={row.userId ?? `none-${i}`}
            className="flex items-center gap-2 text-[12px]"
          >
            <span
              className={cn(
                'w-36 shrink-0 truncate',
                row.fullName ? '' : 'text-muted-foreground italic',
              )}
              title={row.fullName ?? undefined}
            >
              {row.fullName ?? 'Не указан'}
            </span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn('block h-full rounded-full', barClass)}
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
            <span className="tnum w-6 shrink-0 text-right text-[12px] font-semibold">
              {row.count}
            </span>
          </div>
        ))}
        {/* итог по всем сотрудникам */}
        <div className="flex items-center gap-2 border-t pt-1 text-[12px]">
          <span className="w-36 shrink-0 font-medium text-muted-foreground">
            Всего
          </span>
          <span className="min-w-0 flex-1" />
          <span className="tnum w-6 shrink-0 text-right text-[12px] font-bold">
            {total}
          </span>
        </div>
      </div>
    </div>
  );
}

function VacanciesBlock({ items, total }: { items: WeeklyVacancyItem[]; total: number }) {
  const navigate = useNavigate();
  return (
    <div>
      <BlockHeader
        icon={Briefcase}
        label="Новые вакансии"
        total={total}
        iconClass="text-sky-500"
      />
      {items.length === 0 ? (
        <EmptyRow text="За эту неделю новых вакансий нет" />
      ) : (
        <div className="divide-y rounded-md border bg-muted/20">
          {items.map((v) => {
            const meta = vacancyStatuses.find((s) => s.id === v.status);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => navigate({ to: '/vacancies/$id', params: { id: v.id } })}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-accent/50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{v.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {v.clientName}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="flex items-center justify-end gap-1.5 text-[11px]">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: meta?.color ?? '#94a3b8' }}
                    />
                    {meta?.label ?? v.status}
                  </span>
                  <span className="tnum block text-[10.5px] text-muted-foreground">
                    {format(new Date(v.createdAt), 'd MMM', { locale: ru })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubmissionsBlock({
  items,
  total,
}: {
  items: WeeklySubmissionItem[];
  total: number;
}) {
  const navigate = useNavigate();
  return (
    <div>
      <BlockHeader
        icon={UserPlus}
        label="Поданы кандидаты"
        total={total}
        iconClass="text-emerald-500"
      />
      {items.length === 0 ? (
        <EmptyRow text="За эту неделю кандидатов не подавали" />
      ) : (
        <div className="divide-y rounded-md border bg-muted/20">
          {items.map((s) => {
            const meta = MATCH_STATUS_META[s.status];
            return (
              <div
                key={s.matchId}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] transition hover:bg-accent/50"
              >
                <span className="min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      navigate({ to: '/candidates/$id', params: { id: s.candidateId } })
                    }
                    className="block max-w-full truncate text-left font-medium hover:underline"
                  >
                    {s.candidateName}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigate({ to: '/vacancies/$id', params: { id: s.vacancyId } })
                    }
                    className="block max-w-full truncate text-left text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                    title={`${s.vacancyTitle} · ${s.clientName}`}
                  >
                    → {s.vacancyTitle} · {s.clientName}
                  </button>
                </span>
                <span className="shrink-0 text-right">
                  <span className={cn('block text-[11px] font-medium', meta?.className)}>
                    {meta?.label ?? s.status}
                  </span>
                  <span className="tnum block text-[10.5px] text-muted-foreground">
                    {format(new Date(s.addedAt), 'd MMM', { locale: ru })}
                    {s.addedByName ? ` · ${s.addedByName}` : ''}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
