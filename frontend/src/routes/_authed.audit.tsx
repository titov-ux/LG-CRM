import { createFileRoute } from '@tanstack/react-router';
import { SectionAccessGuard } from '@/components/common/SectionAccessGuard';
import { AuditPage } from '@/features/audit/AuditPage';

export const Route = createFileRoute('/_authed/audit')({
  component: () => (
    <SectionAccessGuard
      action="audit:view"
      adminAlways
      description="У вашей роли нет доступа к журналу действий."
    >
      <AuditPage />
    </SectionAccessGuard>
  ),
});
