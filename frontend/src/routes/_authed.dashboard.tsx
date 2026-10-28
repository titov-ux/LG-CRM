import { Navigate, createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '@/features/analytics/DashboardPage';
import { usePermissionsMatrix } from '@/features/permissions/hooks';
import { useCan } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth';

/**
 * «Главная» (дашборд) — только администратор: там маржа по клиентам и
 * рекрутерам и ФИО кандидатов по всей компании. Бэкенд закрывает /analytics/*
 * тем же правилом (`require_roles(admin)`). Остальные роли после входа
 * попадают в свой рабочий раздел.
 */
function DashboardRoute() {
  const role = useAuthStore((s) => s.user?.role);
  const { isLoading } = usePermissionsMatrix();
  const canViewVacancies = useCan('vacancy:view');
  const canViewCandidates = useCan('candidate:view');
  const canAccessLeads = useCan('lead:access');

  if (!role) return null;
  if (role === 'admin') return <DashboardPage />;
  // Ждём серверную матрицу, чтобы не увести по дефолтным правам.
  if (isLoading) return null;

  const to = canViewVacancies
    ? '/vacancies'
    : canViewCandidates
      ? '/candidates'
      : canAccessLeads
        ? '/leads'
        : '/tasks';
  return <Navigate to={to} replace />;
}

export const Route = createFileRoute('/_authed/dashboard')({
  component: DashboardRoute,
});
