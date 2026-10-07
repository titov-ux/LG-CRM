import { Outlet, createFileRoute } from '@tanstack/react-router';
import { LeadsKanbanPage } from '@/features/leads/LeadsKanbanPage';

export const Route = createFileRoute('/_authed/leads')({
  component: () => (
    <>
      <LeadsKanbanPage />
      <Outlet />
    </>
  ),
});
