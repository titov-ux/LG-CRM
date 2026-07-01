import type { ReactNode } from 'react';
import { Navigate, useRouterState } from '@tanstack/react-router';
import { useMe } from './useAuth';
import { useAuthStore } from '@/stores/auth';
import { Skeleton } from '@/components/ui/skeleton';

export function AuthGuard({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  // Полный текущий адрес (path+search+hash), чтобы вернуть сюда после логина.
  const href = useRouterState({ select: (s) => s.location.href });
  const { data: user, isLoading, isError } = useMe();

  // В dev-режиме MSW сразу отдаёт /auth/me даже без токена — так удобнее зайти после reload.
  // В проде запрос упадёт 401, и мы редиректим на /login.
  if (isLoading && !user) {
    return (
      <div className="grid h-screen place-items-center">
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }

  if (isError && !token) {
    return <Navigate to="/login" search={{ redirect: href }} />;
  }

  return <>{children}</>;
}
