import { Outlet, createFileRoute } from '@tanstack/react-router';
import { SectionAccessGuard } from '@/components/common/SectionAccessGuard';
import { CandidatesDatabasePage } from '@/features/candidates/CandidatesDatabasePage';

export const Route = createFileRoute('/_authed/database')({
  component: () => (
    <SectionAccessGuard
      action="candidate:view"
      description="У вашей роли нет доступа к кандидатам."
    >
      <CandidatesDatabasePage />
      <Outlet />
    </SectionAccessGuard>
  ),
});
