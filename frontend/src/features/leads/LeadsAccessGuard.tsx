import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { useCan } from '@/lib/permissions';

/**
 * Вкладка «Лиды» доступна по праву `lead:access` (по умолчанию — админ,
 * аккаунт-менеджер и менеджер по продажам). Бэкенд без права отвечает 403,
 * здесь — понятная заглушка вместо пустой доски и ошибок.
 */
export function LeadsAccessGuard({ children }: { children: React.ReactNode }) {
  const canAccess = useCan('lead:access');
  if (!canAccess) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Раздел недоступен"
        description="Лиды ведут администраторы, аккаунт-менеджеры и менеджеры по продажам."
      />
    );
  }
  return <>{children}</>;
}
