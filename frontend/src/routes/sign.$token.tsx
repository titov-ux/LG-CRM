import { createFileRoute } from '@tanstack/react-router';
import { SignPortalPage } from '@/features/hrEdo/SignPortalPage';

// Публичный портал подписания кадровых документов (без AuthGuard, как
// invite.$token): аутстафф-специалист входит по ссылке из письма + SMS-коду.
export const Route = createFileRoute('/sign/$token')({
  component: SignPortalPage,
});
