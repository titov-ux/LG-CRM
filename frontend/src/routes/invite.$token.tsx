import { createFileRoute } from '@tanstack/react-router';
import { InvitePage } from '@/features/auth/InvitePage';

// Публичный роут (без AuthGuard): пользователь ещё не залогинен, у него только
// одноразовый токен из письма. На странице он задаёт пароль и сразу логинится.
export const Route = createFileRoute('/invite/$token')({
  component: InvitePage,
});
