import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAttention,
  useClientPerformance,
  useFunnelV2,
  useRecruiterPerformance,
  useSummary,
  useTimeToHire,
  useTrends,
} from './hooks';
import { PeriodPicker } from './PeriodPicker';
import { KpiCard } from './KpiCard';
import { TrendsChart } from './TrendsChart';
import { FunnelChart } from './FunnelChart';
import { TimeToHireCard } from './TimeToHireCard';
import { AttentionList } from './AttentionList';
import { RecruitersTable } from './RecruitersTable';
import { ClientsTable } from './ClientsTable';
import {
  COMPARE_LABEL,
  resolvePeriod,
  useAnalyticsPeriod,
} from '@/stores/analyticsPeriod';

export function DashboardPage() {
  const { preset, custom, compare } = useAnalyticsPeriod();
  const period = useMemo(() => resolvePeriod(preset, custom), [preset, custom]);
  const queryParams = useMemo(
    () => ({ from: period.from, to: period.to }),
    [period.from, period.to],
  );

  const { data: summary, isLoading } = useSummary({
    ...queryParams,
    compare,
  });
  const { data: trends, isLoading: trendsLoading } = useTrends(queryParams);
  const { data: funnel, isLoading: funnelLoading } = useFunnelV2(queryParams);
  const { data: tth, isLoading: tthLoading } = useTimeToHire(queryParams);
  const { data: attention, isLoading: attentionLoading } = useAttention(5);
  const { data: recruiters, isLoading: recruitersLoading } =
    useRecruiterPerformance(queryParams);
  const { data: clientsPerf, isLoading: clientsPerfLoading } =
    useClientPerformance(queryParams);

  const deltaCaption = compare === 'none' ? undefined : COMPARE_LABEL[compare];

  return (
    <div className="flex-1 space-y-3 overflow-auto px-6 pb-6 pt-5">
      {/* Заголовок + селектор периода */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Дашборд</h1>
          <p className="text-[11.5px] text-muted-foreground">
            Метрики обновляются на чтении. KPI и тренды — за выбранный период.
          </p>
        </div>
        <PeriodPicker />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        {isLoading || !summary ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <KpiCard
              label="Открытых вакансий"
              value={summary.openVacancies}
              goodDirection="neutral"
            />
            <KpiCard
              label="Активных кандидатов"
              value={summary.activeCandidates}
              goodDirection="neutral"
            />
            <KpiCard
              label="Закрыто за период"
              value={summary.closedThisMonth}
              delta={summary.delta.closedThisMonth}
              deltaCaption={deltaCaption}
              goodDirection="up"
            />
            <KpiCard
              label="Трудоустроено"
              value={summary.hiredThisMonth}
              delta={summary.delta.hiredThisMonth}
              deltaCaption={deltaCaption}
              goodDirection="up"
            />
          </>
        )}
      </div>

      {/* Тренды */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Динамика за период</CardTitle>
          {trends && (
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              шаг: {trends.granularity === 'day' ? 'день' : trends.granularity === 'week' ? 'неделя' : 'месяц'}
            </span>
          )}
        </CardHeader>
        <CardContent>
          <TrendsChart data={trends} isLoading={trendsLoading} />
        </CardContent>
      </Card>

      {/* Воронка + Time-to-hire */}
      <div className="grid grid-cols-[1.4fr_1fr] gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Воронка matching</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelChart data={funnel} isLoading={funnelLoading} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Скорость найма</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeToHireCard data={tth} isLoading={tthLoading} />
          </CardContent>
        </Card>
      </div>

      {/* Требует внимания — полная ширина */}
      <Card>
        <CardHeader>
          <CardTitle>Требует внимания</CardTitle>
        </CardHeader>
        <CardContent>
          <AttentionList data={attention} isLoading={attentionLoading} />
        </CardContent>
      </Card>

      {/* Эффективность рекрутеров */}
      <Card>
        <CardHeader>
          <CardTitle>Эффективность рекрутеров</CardTitle>
        </CardHeader>
        <CardContent>
          <RecruitersTable data={recruiters} isLoading={recruitersLoading} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Аналитика по клиентам</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientsTable data={clientsPerf} isLoading={clientsPerfLoading} />
        </CardContent>
      </Card>
    </div>
  );
}
