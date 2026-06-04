import { Outlet, createFileRoute } from '@tanstack/react-router';
import { TendersKanbanPage } from '@/features/tenders/TendersKanbanPage';

export const Route = createFileRoute('/_authed/tenders')({
  component: () => (
    <>
      <TendersKanbanPage />
      <Outlet />
    </>
  ),
});
