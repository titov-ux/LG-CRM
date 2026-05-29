/**
 * Layout-роут для /settings.
 *
 * Раньше это был leaf с SettingsPage прямо здесь. Но как только у settings
 * появились дочерние роуты (например, OAuth-callback hh.ru по пути
 * /settings/integrations/hh/callback), TanStack Router перестал их
 * рендерить — родительский leaf не отдавал место под Outlet, и роутер тихо
 * фолбэчил на `/settings`. Симптом: после возврата с hh OAuth-exchange не
 * вызывался.
 *
 * Поэтому теперь:
 *   _authed.settings.tsx           ← этот файл, layout с Outlet
 *   _authed.settings.index.tsx     ← собственно SettingsPage по `/settings`
 *   _authed.settings.integrations.hh.callback.tsx ← рендерится через Outlet
 */
import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authed/settings')({
  component: () => <Outlet />,
});
