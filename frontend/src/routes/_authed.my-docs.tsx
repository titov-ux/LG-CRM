import { createFileRoute, redirect } from '@tanstack/react-router';
import { HR_EDO_ENABLED } from '@/lib/constants';
import { MyDocsPage } from '@/features/hrEdo/MyDocsPage';

export const Route = createFileRoute('/_authed/my-docs')({
  // Раздел «Кадры» пока скрыт — прямой переход ведёт на главную.
  beforeLoad: () => {
    if (!HR_EDO_ENABLED) throw redirect({ to: '/dashboard' });
  },
  component: MyDocsPage,
});
