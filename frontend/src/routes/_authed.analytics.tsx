import { createFileRoute } from '@tanstack/react-router';
import { AdminOnlyGuard } from '@/components/common/AdminOnlyGuard';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';

export const Route = createFileRoute('/_authed/analytics')({
  component: () => (
    <AdminOnlyGuard>
      <AnalyticsPage />
    </AdminOnlyGuard>
  ),
});
