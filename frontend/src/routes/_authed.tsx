import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/features/auth/AuthGuard';
import { usePermissionsMatrix } from '@/features/permissions/hooks';
import { useRealtimeSync } from '@/features/realtime/useRealtimeSync';

const TITLES: Record<string, string> = {
  '/dashboard': 'Главная',
  '/vacancies': 'Вакансии',
  '/candidates': 'Кандидаты',
  '/database': 'Все кандидаты',
  '/clients': 'Клиенты',
  '/contacts': 'Контакты',
  '/documents': 'Документы',
  '/notifications': 'Уведомления',
  '/chat': 'Чат',
  '/analytics': 'Аналитика',
  '/audit': 'Журнал действий',
  '/roles': 'Роли и доступы',
  '/settings': 'Настройки',
};

function titleFor(pathname: string): string {
  const match = Object.keys(TITLES).find((p) => pathname.startsWith(p));
  return match ? TITLES[match] : 'SaaS';
}

function AuthedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Один раз монтируем «глобальный» запрос матрицы доступов — он же зеркалит
  // последний снимок в sync-кэш для can()/useCan() во всём приложении.
  usePermissionsMatrix();
  // Realtime: WebSocket-канал с backend, инвалидирует react-query кэш на
  // события чужих вкладок. Канбан-доски вакансий и кандидатов обновляются
  // автоматически у всех залогиненных пользователей.
  useRealtimeSync();
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
