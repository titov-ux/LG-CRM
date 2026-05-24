import type { TimeToHireResponse } from '@/api/analytics';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const STAGE_LABEL: Record<string, string> = {
  new: 'Новый',
  recruiter_iv: 'Интервью рекрутера',
  ready: 'Готов',
  presented: 'Презентован',
  waiting_os: 'Ожидание ОС',
  offer: 'Оффер',
  hired: 'Нанят',
  reserve: 'Резерв',
  rejected_client: 'Отказ клиента',
  rejected_candidate: 'Отказ кандидата',
};

interface TimeToHireCardProps {
  data: TimeToHireResponse | undefined;
  isLoading?: boolean;
}

export function TimeToHireCard({ data, isLoading }: TimeToHireCardProps) {
  if (isLoading) {
    return <Skeleton className="h-[260px]" />;
  }
  if (!data || data.sampleSize === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        За выбранный период не было закрытых наймов
      </div>
    );
  }

  const totalDist = Math.max(1, data.distribution.reduce((s, b) => s + b.count, 0));
  const maxStage = Math.max(1, ...data.byStage.map((s) => s.avgDays));

  return (
    <div className="space-y-4">
      {/* Главные числа */}
      <div className="grid grid-cols-3 gap-3 border-b pb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
            Медиана
          </div>
          <div className="tnum flex items-baseline gap-1">
            <span className="text-[26px] font-bold leading-none tracking-tight">
              {data.medianDays.toFixed(0)}
            </span>
            <span className="text-[11px] text-muted-foreground">дн.</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
            Среднее
          </div>
          <div className="tnum flex items-baseline gap-1">
            <span className="text-[18px] font-semibold leading-none">
              {data.avgDays.toFixed(1)}
            </span>
            <span className="text-[11px] text-muted-foreground">дн.</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
            P90
          </div>
          <div className="tnum flex items-baseline gap-1">
            <span className="text-[18px] font-semibold leading-none">
              {data.p90Days.toFixed(0)}
            </span>
            <span className="text-[11px] text-muted-foreground">дн.</span>
          </div>
        </div>
      </div>

      {/* Распределение */}
      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/80">
          Распределение ({data.sampleSize} наймов)
        </div>
        <div className="space-y-1.5">
          {data.distribution.map((b) => {
            const pct = (b.count / totalDist) * 100;
            return (
              <div
                key={b.label}
                className="grid grid-cols-[110px_1fr_44px] items-center gap-2 text-[11.5px]"
              >
                <span className="text-muted-foreground">{b.label}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full transition-all',
                      b.maxDays === 14
                        ? 'bg-emerald-500'
                        : b.maxDays === 30
                          ? 'bg-sky-500'
                          : b.maxDays === 60
                            ? 'bg-amber-500'
                            : 'bg-rose-500',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="tnum text-right font-semibold">
                  {b.count}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    {Math.round(pct)}%
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Время в стадии */}
      {data.byStage.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/80">
            Среднее время в стадии
          </div>
          <div className="space-y-1.5">
            {data.byStage.map((s) => (
              <div
                key={s.status}
                className="grid grid-cols-[140px_1fr_56px] items-center gap-2 text-[11.5px]"
              >
                <span className="truncate text-muted-foreground">
                  {STAGE_LABEL[s.status] ?? s.status}
                </span>
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-slate-500 transition-all"
                    style={{ width: `${(s.avgDays / maxStage) * 100}%` }}
                  />
                </div>
                <span className="tnum text-right font-semibold">
                  {s.avgDays.toFixed(1)} дн.
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
