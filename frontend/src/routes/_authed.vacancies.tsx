import { Outlet, createFileRoute } from '@tanstack/react-router';
import { SectionAccessGuard } from '@/components/common/SectionAccessGuard';
import { VacanciesKanbanPage } from '@/features/vacancies/VacanciesKanbanPage';

export const Route = createFileRoute('/_authed/vacancies')({
  component: () => (
    <SectionAccessGuard action="vacancy:view" description="У вашей роли нет доступа к вакансиям.">
      <VacanciesKanbanPage />
      <Outlet />
    </SectionAccessGuard>
  ),
});
