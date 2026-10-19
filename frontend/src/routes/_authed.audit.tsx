import { createFileRoute } from '@tanstack/react-router';
import { AdminOnlyGuard } from '@/components/common/AdminOnlyGuard';
import { AuditPage } from '@/features/audit/AuditPage';

export const Route = createFileRoute('/_authed/audit')({
  component: () => (
    <AdminOnlyGuard>
      <AuditPage />
    </AdminOnlyGuard>
  ),
});
