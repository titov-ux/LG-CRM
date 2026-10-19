import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { useCan, type Action } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth';

/**
 * Заглушка «Раздел недоступен» для разделов, закрытых правом матрицы доступов
 * (например, `vacancy:view` / `candidate:view` у менеджера по продажам).
 * Бэкенд без права отвечает 403 — здесь понятный экран вместо пустой доски.
 *
 * `adminAlways` — администратор проходит независимо от галочки (зеркало
 * backend-зависимости `require_action_or_admin`, например «Журнал действий»).
 */
export function SectionAccessGuard({
  action,
  adminAlways = false,
  description,
  children,
}: {
  action: Action;
  adminAlways?: boolean;
  description?: string;
  children: React.ReactNode;
}) {
  const allowedByMatrix = useCan(action);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const allowed = allowedByMatrix || (adminAlways && isAdmin);
  if (!allowed) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Раздел недоступен"
        description={description ?? 'У вашей роли нет доступа к этому разделу.'}
      />
    );
  }
  return <>{children}</>;
}
