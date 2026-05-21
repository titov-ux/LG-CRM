import { api } from './client';
import type { Role } from './types';
import type { MatrixPermission } from '@/lib/permissions-data';

// REST-контракт под матрицу доступов. Сейчас сервируется через MSW
// (см. `src/mocks/handlers.ts` + `src/mocks/db/permissionsMatrix.ts`),
// но контракт нейтральный — реальный бэк сможет реализовать его 1-в-1
// без правок на фронте.
//
// Endpoints:
//   GET    /permissions-matrix         → { items: MatrixPermission[] }
//   PUT    /permissions-matrix/:id     → MatrixPermission  (body: { matrix })
//   POST   /permissions-matrix/reset   → { items: MatrixPermission[] }

export const permissionsMatrixApi = {
  list: () => api.get('permissions-matrix').json<{ items: MatrixPermission[] }>(),
  updateRow: (id: string, matrix: Record<Role, boolean>) =>
    api.put(`permissions-matrix/${id}`, { json: { matrix } }).json<MatrixPermission>(),
  reset: () =>
    api.post('permissions-matrix/reset', { json: {} }).json<{ items: MatrixPermission[] }>(),
};
