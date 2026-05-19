import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AnalyticsPage() {
  return (
    <div className="flex-1 overflow-auto px-6 pb-6">
      <Card>
        <CardHeader><CardTitle>Аналитика</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Расширенные отчёты появятся на этапе 2 (после walking skeleton). Базовый набор метрик доступен
          в разделе «Главная».
        </CardContent>
      </Card>
    </div>
  );
}
