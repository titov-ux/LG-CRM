import { create } from 'zustand';
import type { MatrixPermission } from '@/lib/permissions-data';
import { cloneDefaultPermissions } from '@/lib/permissions-data';

// In-memory snapshot матрицы доступов: единственное назначение — позволить
// синхронному `can(role, action)` (см. lib/permissions.ts) отвечать без await
// и без зависимости от React Query из не-React кода.
//
// Источник правды — сервер. Этот стор обновляется из TanStack Query-хука
// `usePermissionsMatrix` (см. features/permissions/hooks.ts) на каждый успешный
// fetch / мутацию. Никаких пользовательских действий писать сюда напрямую не нужно:
// мутации UI идут через React Query, который сам кладёт ответ сервера обратно сюда.
//
// Стартовое состояние — DEFAULT_PERMISSIONS: безопасный fallback до первого ответа
// сервера. persist специально не используется — мы не хотим, чтобы устаревший
// localStorage-снимок перекрывал свежий ответ бэка.

interface PermissionsMatrixCacheState {
  permissions: MatrixPermission[];
  /** Заменяет снимок целиком. Вызывается из React Query при загрузке/мутации. */
  setPermissions: (rows: MatrixPermission[]) => void;
}

export const usePermissionsMatrixCache = create<PermissionsMatrixCacheState>((set) => ({
  permissions: cloneDefaultPermissions(),
  setPermissions: (permissions) => set({ permissions }),
}));
