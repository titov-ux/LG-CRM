import { createFileRoute } from '@tanstack/react-router';
import { AdminOnlyGuard } from '@/components/common/AdminOnlyGuard';
import { RolesPage } from '@/features/users/RolesPage';

export const Route = createFileRoute('/_authed/roles')({
  component: () => (
    <AdminOnlyGuard>
      <RolesPage />
    </AdminOnlyGuard>
  ),
});
