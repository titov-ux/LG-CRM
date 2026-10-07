import { Outlet, createFileRoute } from '@tanstack/react-router';
import { LeadsAccessGuard } from '@/features/leads/LeadsAccessGuard';
import { LeadsKanbanPage } from '@/features/leads/LeadsKanbanPage';

export const Route = createFileRoute('/_authed/leads')({
  component: () => (
    <LeadsAccessGuard>
      <LeadsKanbanPage />
      <Outlet />
    </LeadsAccessGuard>
  ),
});
