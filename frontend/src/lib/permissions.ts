// Клиентская часть доступов. Не заменяет backend-проверку — служит только для UI:
// прятать кнопки/секции, до которых у пользователя нет доступа.
//
// Архитектура:
//   • Источник правды — сервер. Клиент тянет матрицу через `permissionsMatrixApi`
//     (см. `src/api/permissionsMatrix.ts`) и через TanStack Query
//     (см. `src/features/permissions/hooks.ts`).
//   • На время сессии последний полученный snapshot матрицы лежит в zustand-сторе
//     `usePermissionsMatrixCache` — он нужен только для синхронного `can()`
//     (вне React-дерева). React-код должен пользоваться хуком `useCan(action)`.
//   • До первого ответа сервера используются `DEFAULT_PERMISSIONS` — это
//     безопасные стартовые значения, чтобы `can()` не падал и UI не моргал.
//   • Чтобы переключить мок→прод, не нужно ничего здесь менять — поменяется
//     только API_BASE_URL/USE_MOCKS. Контракт `permissionsMatrixApi` универсален.
//
// Данные и типы матрицы лежат в листовом модуле `permissions-data.ts`, чтобы
// не образовывать цикл с сторами/реактом.

import type { Role } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { usePermissionsMatrixCache } from '@/stores/permissionsMatrix';
import type { Action, MatrixPermission } from './permissions-data';

export type { Action, MatrixPermission } from './permissions-data';
export {
  DEFAULT_PERMISSIONS,
  cloneDefaultPermissions,
} from './permissions-data';

/**
 * Композиция через AND: действие разрешено, если КАЖДАЯ строка матрицы,
 * которая его гейтит, помечена `true` для роли. Если ни одна строка не гейтит
 * это действие — возвращаем `false` (deny-by-default).
 */
function checkAction(rows: MatrixPermission[], role: Role, action: Action): boolean {
  const gating = rows.filter((r) => r.actions.includes(action));
  if (gating.length === 0) return false;
  return gating.every((r) => r.matrix[role] === true);
}

/** Синхронная проверка вне React (мутации, утилиты, guards). */
export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  const rows = usePermissionsMatrixCache.getState().permissions;
  return checkAction(rows, role, action);
}

/**
 * React-хук: компонент перерисуется, если матрица или роль изменятся.
 * Использовать ВМЕСТО `can(...)` внутри компонентов.
 */
export function useCan(action: Action): boolean {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const rows = usePermissionsMatrixCache((s) => s.permissions);
  if (!role) return false;
  return checkAction(rows, role, action);
}
