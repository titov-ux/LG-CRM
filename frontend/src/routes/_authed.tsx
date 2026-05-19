import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/features/auth/AuthGuard';

const TITLES: Record<string, string> = {
  '/dashboard': 'Главная',
  '/vacancies': 'Вакансии',
  '/candidates': 'Кандидаты',
  '/clients': 'Клиенты',
  '/contacts': 'Контакты',
  '/notifications': 'Уведомления',
  '/analytics': 'Аналитика',
  '/audit': 'Журнал действий',
  '/roles': 'Роли и доступы',
  '/settings': 'Настройки',
};

function titleFor(pathname: string): string {
  const match = Object.keys(TITLES).find((p) => pathname.startsWith(p));
  return match ? TITLES[match] : 'CRM';
}

function AuthedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <AuthGuard>
      <AppShell title={titleFor(pathname)}>
        <Outlet />
      </AppShell>
    </AuthGuard>
  );
}

export const Route = createFileRoute('/_authed')({
  component: AuthedLayout,
});
