import { createFileRoute } from '@tanstack/react-router';
import { LoginPage } from '@/features/auth/LoginPage';

export const Route = createFileRoute('/login')({
  // Сохраняем адрес, куда пользователь шёл до редиректа на логин (deep-link из
  // Telegram/почты). Пускаем только внутренние пути (начинается с одного «/»),
  // чтобы не было open-redirect на внешние домены.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const r = search.redirect;
    const safe =
      typeof r === 'string' &&
      r.startsWith('/') &&
      !r.startsWith('//') &&
      // redirect на сам /login (в т.ч. вложенный login?redirect=login?…) — мусор
      // от бага с зацикливанием; отбрасываем, после входа уйдём на /dashboard.
      !r.startsWith('/login');
    return { redirect: safe ? (r as string) : undefined };
  },
  component: LoginPage,
});
