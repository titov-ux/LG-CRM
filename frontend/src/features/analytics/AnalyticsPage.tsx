import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';
import { resolvePeriod, useAnalyticsPeriod } from '@/stores/analyticsPeriod';
import { useWorklogSummary } from './hooks';
import { PeriodPicker } from './PeriodPicker';
import { WorklogTable } from './WorklogTable';

export function AnalyticsPage() {
  const { preset, custom } = useAnalyticsPeriod();
  const period = useMemo(() => resolvePeriod(preset, custom), [preset, custom]);
  const queryParams = useMemo(
    () => ({ from: period.from, to: period.to }),
    [period.from, period.to],
  );

  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  // Хук вызываем всегда (правило хуков), но запрос включаем только админам —
  // иначе бэк всё равно ответит 403.
  const { data, isLoading } = useWorklogSummary(queryParams, isAdmin);

  if (!isAdmin) {
    return (
      <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
        <Card>
          <CardHeader>
            <CardTitle>Учёт времени</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Раздел доступен только администраторам.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-auto px-6 pb-6 pt-5">
      {/* Заголовок + селектор периода */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Учёт времени</h1>
          <p className="text-[11.5px] text-muted-foreground">
            Время, проведённое сотрудниками в системе, за выбранный период.
          </p>
        </div>
        <PeriodPicker />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[13px]">Время в системе</CardTitle>
        </CardHeader>
        <CardContent>
          <WorklogTable data={data} isLoading={isLoading} />
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            «В системе» — онлайн-время по сессиям (открыта вкладка CRM, от входа
            до выхода). «Активно» — время, когда вкладка была в фокусе и шло
            взаимодействие; периоды простоя не учитываются.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
