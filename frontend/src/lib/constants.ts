// Конфигурационные константы фронта. Из ENV — только runtime-настройки.

export const APP_TITLE = import.meta.env.VITE_APP_TITLE ?? 'ЛГ Интеграция · CRM';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

// Сборка / окружение — для информационного поповера в сайдбаре.
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.0-dev';
export const APP_RELEASE_DATE = import.meta.env.VITE_APP_RELEASE_DATE ?? '2026-05-19';
export const APP_COMMIT = import.meta.env.VITE_APP_COMMIT ?? 'local';
export type AppEnv = 'dev' | 'stage' | 'prod';
export const APP_ENV: AppEnv =
  (import.meta.env.VITE_APP_ENV as AppEnv | undefined) ??
  (import.meta.env.DEV ? 'dev' : 'prod');
export const CHANGELOG_URL =
  import.meta.env.VITE_CHANGELOG_URL ?? 'https://github.com/lg-integration/crm/blob/main/CHANGELOG.md';

export const QUERY_DEFAULTS = {
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  retry: 1,
} as const;

export const PAGE_SIZE_DEFAULT = 50;
