import { createFileRoute, redirect } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/auth';
import { LoginSnapshotsPage } from '@/features/security/LoginSnapshotsPage';

export const Route = createFileRoute('/_authed/login-snapshots')({
  // Журнал снимков — только для админов. Серверная проверка стоит на эндпоинте
  // (require_roles admin); здесь дублируем на клиенте, чтобы не показывать
  // пустую страницу с 403.
  beforeLoad: () => {
    const role = useAuthStore.getState().user?.role;
    if (role && role !== 'admin') {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: LoginSnapshotsPage,
});
