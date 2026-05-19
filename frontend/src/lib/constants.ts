// Конфигурационные константы фронта. Из ENV — только runtime-настройки.

export const APP_TITLE = import.meta.env.VITE_APP_TITLE ?? 'ЛГ Интеграция · CRM';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

export const QUERY_DEFAULTS = {
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  retry: 1,
} as const;

export const PAGE_SIZE_DEFAULT = 50;
