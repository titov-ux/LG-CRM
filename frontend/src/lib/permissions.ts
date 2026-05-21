// Клиентская проверка прав. Не заменяет backend-проверку, нужна только для UI:
// прятать кнопки/секции, до которых у пользователя нет доступа. Серверная сторона
// должна повторять эти же проверки — это «defense in depth».

import type { Role } from '@/api/types';

type Action =
  | 'client:create'
  | 'client:edit'
  | 'vacancy:create'
  | 'vacancy:edit'
  | 'vacancy:change_status'
  | 'candidate:create'
  | 'candidate:edit'
  | 'candidate:change_status'
  | 'audit:view'
  | 'analytics:view'
  | 'user:manage';

const MATRIX: Record<Action, Role[]> = {
  'client:create': ['admin', 'account_manager'],
  'client:edit': ['admin', 'account_manager'],
  'vacancy:create': ['admin', 'account_manager', 'recruiter'],
  'vacancy:edit': ['admin', 'account_manager', 'recruiter'],
  'vacancy:change_status': ['admin', 'account_manager', 'recruiter'],
  'candidate:create': ['admin', 'recruiter'],
  'candidate:edit': ['admin', 'recruiter'],
  'candidate:change_status': ['admin', 'recruiter'],
  'audit:view': ['admin'],
  'analytics:view': ['admin', 'account_manager'],
  'user:manage': ['admin'],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return MATRIX[action].includes(role);
}
