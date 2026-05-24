import type { FunnelResponse } from '@/api/analytics';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const STAGE_LABEL: Record<string, string> = {
  submitted: 'Подан',
  reviewed: 'Просмотрен',
  interview: 'Интервью',
  offered: 'Оффер',
  accepted: 'Принят',
};

interface FunnelChartProps {
  data: FunnelResponse | undefined;
  isLoading?: boolean;
}

export function FunnelChart({ data, isLoading }: FunnelChartProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    );
  }
  if (!data || data.stages.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        Нет данных за выбранный период
      </div>
    );
  }

  const top = Math.max(1, data.stages[0].count);

  return (
    <div>
      {/* Шапка: overall + отказы — приглушённо, в notion-tone */}
      <div className="mb-4 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Overall
          </span>
          <span className="tnum text-[18px] font-medium tabular-nums text-foreground">
            {data.overallConversionPct.toFixed(1)}%
          </span>
          <span className="tnum text-[11.5px] text-muted-foreground">
            {data.stages[0].count} → {data.stages[data.stages.length - 1].count}
          </span>
        </div>
        {data.rejected.total > 0 && (
          <div className="flex items-baseline gap-1.5 text-[11.5px] text-muted-foreground">
            <span>Отказы</span>
            <span className="tnum text-foreground">{data.rejected.total}</span>
            <span className="text-muted-foreground/70">
              ({data.rejected.client} клиент · {data.rejected.internal} внутр.)
            </span>
          </div>
        )}
      </div>

      {/* Стадии — таблица в notion-стиле */}
      <div className="divide-y divide-border/60">
        {data.stages.map((s, i) => {
          const widthPct = (s.count / top) * 100;
          const label = STAGE_LABEL[s.status] ?? s.status;
          // Цвет conversion-метки: только когда совсем плохо (<40 %) делаем
          // намёк на тон. Зелёного / янтарного не используем — это Notion.
          const convClass = cn(
            'tnum',
            i === 0
              ? 'text-muted-foreground/60'
              : s.conversionPct < 40
                ? 'text-foreground/85'
                : 'text-muted-foreground',
          );
          return (
            <div
              key={s.status}
              className="grid grid-cols-[110px_1fr_auto] items-center gap-4 py-2.5"
            >
              <div className="text-[13px] text-foreground/80">{label}</div>

              {/* прогресс — серая дорожка с тёмной заливкой */}
              <div className="flex items-center gap-3">
                <div className="h-[6px] flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-full rounded-sm bg-foreground/85 transition-all"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="tnum w-9 text-right text-[13px] font-medium text-foreground">
                  {s.count}
                </span>
              </div>

              {/* конверсия + drop — приглушённо, в одну строку */}
              <div className="tnum flex w-[120px] items-baseline justify-end gap-2 text-[11.5px]">
                {i > 0 ? (
                  <>
                    <span className={convClass}>{s.conversionPct.toFixed(1)}%</span>
                    {s.dropOff > 0 && (
                      <span className="text-muted-foreground/60">−{s.dropOff}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground/60">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
