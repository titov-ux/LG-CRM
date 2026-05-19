import { Outlet, createFileRoute } from '@tanstack/react-router';
import { CandidatesKanbanPage } from '@/features/candidates/CandidatesKanbanPage';

export const Route = createFileRoute('/_authed/candidates')({
  component: () => (
    <>
      <CandidatesKanbanPage />
      <Outlet />
    </>
  ),
});
