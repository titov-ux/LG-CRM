import { cloneDefaultPermissions, type MatrixPermission } from '@/lib/permissions-data';

// In-memory + localStorage слепок матрицы доступов для MSW.
// localStorage используется чисто как мок-«база»: даёт UX «изменения сохраняются»
// без настоящего бэка. Когда появится реальный API — этот файл удаляется,
// MSW-хендлеры тоже, и больше ничего трогать не нужно.

const STORAGE_KEY = 'crm-lg.msw.permissions-matrix';

function load(): MatrixPermission[] {
  if (typeof window === 'undefined') return cloneDefaultPermissions();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaultPermissions();
    const parsed = JSON.parse(raw) as MatrixPermission[];
    // Подмешиваем дефолты сверху — если в коде добавились новые строки, они
    // не должны теряться из-за устаревшего localStorage. Идентифицируем по `id`.
    const defaults = cloneDefaultPermissions();
    return defaults.map((def) => {
      const saved = parsed.find((p) => p.id === def.id);
      return saved
        ? { ...def, matrix: { ...def.matrix, ...saved.matrix } }
        : def;
    });
  } catch {
    return cloneDefaultPermissions();
  }
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(permissionsMatrixDb));
  } catch {
    /* quota / privacy mode — silently ignore */
  }
}

export let permissionsMatrixDb: MatrixPermission[] = load();

export function updatePermissionRow(
  id: string,
  matrix: MatrixPermission['matrix'],
): MatrixPermission | null {
  const idx = permissionsMatrixDb.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const next = { ...permissionsMatrixDb[idx], matrix: { ...matrix } };
  permissionsMatrixDb = permissionsMatrixDb.map((p, i) => (i === idx ? next : p));
  persist();
  return next;
}

export function resetPermissionsMatrix(): MatrixPermission[] {
  permissionsMatrixDb = cloneDefaultPermissions();
  persist();
  return permissionsMatrixDb;
}
