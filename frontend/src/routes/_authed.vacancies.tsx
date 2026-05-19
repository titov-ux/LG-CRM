import { Outlet, createFileRoute } from '@tanstack/react-router';
import { VacanciesKanbanPage } from '@/features/vacancies/VacanciesKanbanPage';

export const Route = createFileRoute('/_authed/vacancies')({
  component: () => (
    <>
      <VacanciesKanbanPage />
      <Outlet />
    </>
  ),
});
