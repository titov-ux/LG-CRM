// Инициализация Sentry на фронте. Тихо пропускается, если VITE_SENTRY_DSN пуст
// или пакет `@sentry/react` не установлен.
//
// Чтобы включить:
//   1. pnpm add @sentry/react
//   2. в .env: VITE_SENTRY_DSN=https://...@sentry.io/...
//   3. в main.tsx добавить вызов: `await initSentry()` до createRoot().

export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  // Динамический импорт — не тащим Sentry в бандл, если DSN не задан.
  // Имя модуля прячем в переменную, чтобы tsc не требовал устанавливать
  // `@sentry/react` в dev-зависимостях (ставится только в проде).
  try {
    const moduleName = '@sentry/react';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import(/* @vite-ignore */ moduleName);
    Sentry.init({
      dsn,
      environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string) || 'staging',
      tracesSampleRate: 0.05,
      // Кладём только release-метку (без PII).
      release: import.meta.env.VITE_APP_VERSION,
      sendDefaultPii: false,
    });
  } catch (e) {
    // Если пакета нет — это нормально для dev. Печатаем варн один раз.
    // eslint-disable-next-line no-console
    console.warn('[sentry] @sentry/react не установлен, инициализация пропущена');
  }
}
