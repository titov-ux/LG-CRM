import { Outlet, createFileRoute } from '@tanstack/react-router';
import { SectionAccessGuard } from '@/components/common/SectionAccessGuard';
import { CandidatesKanbanPage } from '@/features/candidates/CandidatesKanbanPage';

export const Route = createFileRoute('/_authed/candidates')({
  component: () => (
    <SectionAccessGuard
      action="candidate:view"
      description="У вашей роли нет доступа к кандидатам."
    >
      <CandidatesKanbanPage />
      <Outlet />
    </SectionAccessGuard>
  ),
});
