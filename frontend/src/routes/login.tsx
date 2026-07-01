import { createFileRoute } from '@tanstack/react-router';
import { LoginPage } from '@/features/auth/LoginPage';

export const Route = createFileRoute('/login')({
  // Сохраняем адрес, куда пользователь шёл до редиректа на логин (deep-link из
  // Telegram/почты). Пускаем только внутренние пути (начинается с одного «/»),
  // чтобы не было open-redirect на внешние домены.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const r = search.redirect;
    const safe = typeof r === 'string' && r.startsWith('/') && !r.startsWith('//');
    return { redirect: safe ? (r as string) : undefined };
  },
  component: LoginPage,
});
