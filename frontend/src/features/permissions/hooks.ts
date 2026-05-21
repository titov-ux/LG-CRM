import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { permissionsMatrixApi } from '@/api/permissionsMatrix';
import { QUERY_DEFAULTS } from '@/lib/constants';
import {
  cloneDefaultPermissions,
  type MatrixPermission,
} from '@/lib/permissions-data';
import { usePermissionsMatrixCache } from '@/stores/permissionsMatrix';
import type { Role } from '@/api/types';

// React-обёртка над матрицей доступов: использует TanStack Query для сетевого
// слоя, и зеркально пишет последний снимок в `usePermissionsMatrixCache`,
// чтобы синхронный `can(role, action)` (см. lib/permissions.ts) тоже видел
// актуальные данные.
//
// Когда появится реальный API — этот файл и `api/permissionsMatrix.ts`
// продолжат работать без изменений; уберутся только MSW-хендлеры.

export const permissionsMatrixKeys = {
  all: ['permissions-matrix'] as const,
};

/**
 * Загружает матрицу с сервера и поддерживает её в актуальном состоянии.
 * Используется страницей «Роли и доступы», но также один раз монтируется
 * на корневом authed-layout — чтобы остальные `useCan(...)` сразу видели
 * серверный снимок, а не только дефолты.
 */
export function usePermissionsMatrix() {
  const setPermissions = usePermissionsMatrixCache((s) => s.setPermissions);
  const query = useQuery({
    queryKey: permissionsMatrixKeys.all,
    queryFn: async () => {
      const { items } = await permissionsMatrixApi.list();
      return items;
    },
    ...QUERY_DEFAULTS,
    staleTime: 5 * 60_000,
  });

  // Зеркалим успешные ответы в sync-кэш для can()/useCan().
  // Делается через useEffect, потому что `onSuccess` в options устарел в v5.
  useEffect(() => {
    if (query.data) setPermissions(query.data);
  }, [query.data, setPermissions]);

  return {
    permissions: query.data ?? usePermissionsMatrixCache.getState().permissions,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}

/**
 * Переключает одну ячейку матрицы. Оптимистично обновляет TanStack Query-кэш
 * и sync-стор, в случае ошибки откатывает.
 */
export function useTogglePermission() {
  const queryClient = useQueryClient();
  const setPermissions = usePermissionsMatrixCache((s) => s.setPermissions);

  return useMutation({
    mutationFn: ({ id, role, allowed }: { id: string; role: Role; allowed: boolean }) => {
      const current = queryClient.getQueryData<MatrixPermission[]>(permissionsMatrixKeys.all);
      const row = current?.find((p) => p.id === id);
      if (!row) {
        return Promise.reject(new Error(`Permission row ${id} not found`));
      }
      const nextMatrix = { ...row.matrix, [role]: allowed };
      return permissionsMatrixApi.updateRow(id, nextMatrix);
    },
    onMutate: async ({ id, role, allowed }) => {
      await queryClient.cancelQueries({ queryKey: permissionsMatrixKeys.all });
      const previous = queryClient.getQueryData<MatrixPermission[]>(permissionsMatrixKeys.all);
      if (previous) {
        const optimistic = previous.map((p) =>
          p.id === id ? { ...p, matrix: { ...p.matrix, [role]: allowed } } : p,
        );
        queryClient.setQueryData(permissionsMatrixKeys.all, optimistic);
        setPermissions(optimistic);
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(permissionsMatrixKeys.all, context.previous);
        setPermissions(context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: permissionsMatrixKeys.all });
    },
  });
}

/** Сбрасывает матрицу к серверным дефолтам. */
export function useResetPermissionsMatrix() {
  const queryClient = useQueryClient();
  const setPermissions = usePermissionsMatrixCache((s) => s.setPermissions);

  return useMutation({
    mutationFn: () => permissionsMatrixApi.reset(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: permissionsMatrixKeys.all });
      const previous = queryClient.getQueryData<MatrixPermission[]>(permissionsMatrixKeys.all);
      // Оптимистично подставляем клиентские дефолты — они должны совпадать
      // с серверными (см. cloneDefaultPermissions). Если разойдутся —
      // onSuccess/invalidate всё равно подтянет авторитетный ответ.
      const optimistic = cloneDefaultPermissions();
      queryClient.setQueryData(permissionsMatrixKeys.all, optimistic);
      setPermissions(optimistic);
      return { previous };
    },
    onSuccess: ({ items }) => {
      queryClient.setQueryData(permissionsMatrixKeys.all, items);
      setPermissions(items);
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(permissionsMatrixKeys.all, context.previous);
        setPermissions(context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: permissionsMatrixKeys.all });
    },
  });
}
