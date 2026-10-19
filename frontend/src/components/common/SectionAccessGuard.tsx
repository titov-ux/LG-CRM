import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { useCan, type Action } from '@/lib/permissions';

/**
 * Заглушка «Раздел недоступен» для разделов, закрытых правом матрицы доступов
 * (например, `vacancy:view` / `candidate:view` у менеджера по продажам).
 * Бэкенд без права отвечает 403 — здесь понятный экран вместо пустой доски.
 */
export function SectionAccessGuard({
  action,
  description,
  children,
}: {
  action: Action;
  description?: string;
  children: React.ReactNode;
}) {
  const allowed = useCan(action);
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
