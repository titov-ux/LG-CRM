import { createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '@/features/analytics/DashboardPage';

export const Route = createFileRoute('/_authed/dashboard')({
  component: DashboardPage,
});
