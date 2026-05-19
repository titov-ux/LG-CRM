import { createFileRoute } from '@tanstack/react-router';
import { VacancyCardPage } from '@/features/vacancies/VacancyCardPage';

export const Route = createFileRoute('/_authed/vacancies/$id')({
  component: VacancyCardPage,
});
