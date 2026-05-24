import { useNavigate } from '@tanstack/react-router';
import {
  AlarmClock,
  CalendarClock,
  CalendarX,
  Hourglass,
  UserX,
} from 'lucide-react';
import type {
  AttentionCandidateBlock,
  AttentionResponse,
} from '@/api/analytics';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AttentionListProps {
  data: AttentionResponse | undefined;
  isLoading?: boolean;
}

export function AttentionList({ data, isLoading }: AttentionListProps) {
  const navigate = useNavigate();
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }
  if (!data) {
    return null;
  }

  const blocks = [
    {
      key: 'overdue' as const,
      icon: CalendarX,
      label: 'Просрочены дедлайны',
      sub: `срок прошёл`,
      tone: 'bad' as const,
      block: data.overdueDeadlines,
      formatRight: (v: any) => `−${v.daysOverdue} дн.`,
    },
    {
      key: 'stuck-vac' as const,
      icon: Hourglass,
      label: `Зависшие вакансии`,
      sub: `> ${data.stuckVacancies.thresholdDays ?? 30} дн. в статусе`,
      tone: 'warn' as const,
      block: data.stuckVacancies,
      formatRight: (v: any) => `${v.daysInStatus} дн.`,
    },
    {
      key: 'no-cand' as const,
      icon: UserX,
      label: 'Открытые без кандидатов',
      sub: 'не прикреплён никто',
      tone: 'warn' as const,
      block: data.vacanciesWithoutCandidates,
      formatRight: (v: any) =>
        v.daysOpen != null ? `открыта ${v.daysOpen} дн.` : '',
    },
    {
      key: 'soon-7' as const,
      icon: CalendarClock,
      label: 'Дедлайны ≤ 7 дн.',
      sub: 'скоро',
      tone: 'info' as const,
      block: data.deadlinesNext7Days,
      formatRight: (v: any) => `${v.daysLeft} дн.`,
    },
  ];

  return (
    <div className="space-y-3">
      {/* строка сводок */}
      <div className="grid grid-cols-5 gap-2">
        <Summary
          label="Зависшие вакансии"
          total={data.stuckVacancies.total}
          tone="warn"
          icon={Hourglass}
        />
        <Summary
          label="Зависшие кандидаты"
          total={data.stuckCandidates.total}
          tone="warn"
          icon={AlarmClock}
        />
        <Summary
          label="Без кандидатов"
          total={data.vacanciesWithoutCandidates.total}
          tone="warn"
          icon={UserX}
        />
        <Summary
          label="Просрочено"
          total={data.overdueDeadlines.total}
          tone="bad"
          icon={CalendarX}
        />
        <Summary
          label="Дедлайн ≤ 14 дн."
          total={data.deadlinesNext7Days.total + data.deadlinesNext14Days.total}
          tone="info"
          icon={CalendarClock}
        />
      </div>

      {/* топ-листы */}
      <div className="space-y-3">
        {blocks.map(({ key, icon: Icon, label, sub, tone, block, formatRight }) => {
          if (!block || block.items.length === 0) return null;
          return (
            <div key={key}>
              <div className="mb-1 flex items-baseline justify-between">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5',
                      tone === 'bad'
                        ? 'text-rose-500'
                        : tone === 'warn'
                          ? 'text-amber-500'
                          : 'text-sky-500',
                    )}
                  />
                  {label}
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                    {block.total} · {sub}
                  </span>
                </div>
              </div>
              <div className="divide-y rounded-md border bg-muted/20">
                {block.items.map((item: any) => {
                  const onClick = () =>
                    navigate({
                      to: '/vacancies/$id',
                      params: { id: item.id },
                    });
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={onClick}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition hover:bg-accent/50"
                    >
                      <span className="truncate font-medium">{item.title}</span>
                      <span
                        className={cn(
                          'tnum ml-2 shrink-0 text-[11px] font-semibold',
                          tone === 'bad'
                            ? 'text-rose-600'
                            : tone === 'warn'
                              ? 'text-amber-600'
                              : 'text-sky-600',
                        )}
                      >
                        {formatRight(item)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* зависшие кандидаты — отдельный список с другим URL */}
        {data.stuckCandidates.items.length > 0 && (
          <StuckCandidates block={data.stuckCandidates} />
        )}
      </div>
    </div>
  );
}

function Summary({
  label,
  total,
  tone,
  icon: Icon,
}: {
  label: string;
  total: number;
  tone: 'bad' | 'warn' | 'info';
  icon: React.ComponentType<{ className?: string }>;
}) {
  const toneClass =
    tone === 'bad'
      ? 'border-rose-300/60 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-200'
      : tone === 'warn'
        ? 'border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
        : 'border-sky-300/60 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-900/20 dark:text-sky-200';
  return (
    <div className={cn('rounded-md border px-2.5 py-2', toneClass)}>
      <div className="mb-0.5 flex items-center gap-1 text-[10.5px] uppercase tracking-wide opacity-80">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="tnum text-[18px] font-bold leading-none">{total}</div>
    </div>
  );
}

function StuckCandidates({ block }: { block: AttentionCandidateBlock }) {
  const navigate = useNavigate();
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold">
          <AlarmClock className="h-3.5 w-3.5 text-amber-500" />
          Зависшие кандидаты
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
            {block.total} · &gt; {block.thresholdDays ?? 14} дн. без движения
          </span>
        </div>
      </div>
      <div className="divide-y rounded-md border bg-muted/20">
        {block.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              navigate({ to: '/candidates/$id', params: { id: item.id } })
            }
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition hover:bg-accent/50"
          >
            <span className="truncate font-medium">{item.fullName}</span>
            <span className="tnum ml-2 shrink-0 text-[11px] font-semibold text-amber-600">
              {item.daysInStatus} дн.
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

