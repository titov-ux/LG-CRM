import { Outlet, createFileRoute } from '@tanstack/react-router';
import { CandidatesDatabasePage } from '@/features/candidates/CandidatesDatabasePage';

export const Route = createFileRoute('/_authed/database')({
  component: () => (
    <>
      <CandidatesDatabasePage />
      <Outlet />
    </>
  ),
});
