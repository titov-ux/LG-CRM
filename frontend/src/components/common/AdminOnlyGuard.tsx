import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { useAuthStore } from '@/stores/auth';

/**
 * Разделы только для администратора («Роли и доступы», «Журнал действий»,
 * «Аналитика»). Жёсткое правило по роли, а не по матрице доступов — бэкенд
 * проверяет то же самое (`require_roles(admin)`).
 */
export function AdminOnlyGuard({ children }: { children: React.ReactNode }) {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Раздел недоступен"
        description="Раздел доступен только администраторам."
      />
    );
  }
  return <>{children}</>;
}
