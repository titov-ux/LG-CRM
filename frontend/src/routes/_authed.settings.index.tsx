import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '@/features/settings/SettingsPage';

// `as any` — до запуска vite-plugin-tanstack-router routeTree.gen.ts ещё
// не знает про этот файл; strict-литерал createFileRoute падает. После
// `pnpm build` плагин перегенерирует tree и тип станет валидным.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)('/_authed/settings/')({
  component: SettingsPage,
});
