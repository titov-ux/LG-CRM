import { createFileRoute, redirect } from '@tanstack/react-router';
import { HR_EDO_ENABLED } from '@/lib/constants';
import { HrDocsPage } from '@/features/hrEdo/HrDocsPage';

// «Кадровые документы» — право hr_edo:manage (админ и бухгалтер); проверка
// внутри страницы, бэкенд всё равно отвечает 403 без права.
export const Route = createFileRoute('/_authed/hr-docs')({
  // Раздел «Кадры» пока скрыт — прямой переход ведёт на главную.
  beforeLoad: () => {
    if (!HR_EDO_ENABLED) throw redirect({ to: '/dashboard' });
  },
  component: HrDocsPage,
});
