import { createFileRoute } from '@tanstack/react-router';
import { HrDocsPage } from '@/features/hrEdo/HrDocsPage';

// «Кадровые документы» — право hr_edo:manage (админ и бухгалтер); проверка
// внутри страницы, бэкенд всё равно отвечает 403 без права.
export const Route = createFileRoute('/_authed/hr-docs')({
  component: HrDocsPage,
});
