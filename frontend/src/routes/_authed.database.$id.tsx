import { createFileRoute } from '@tanstack/react-router';
import { CandidateCardPage } from '@/features/candidates/CandidateCardPage';

// Карточка кандидата из «Базы кандидатов». Используем тот же компонент,
// что и для канбана, но передаём source='database' — это меняет:
//   • кнопку «Назад» (возвращает в /database, а не /candidates);
//   • историю смены статусов делаем явной отдельной секцией;
//   • историю взаимодействий раскрываем полностью по умолчанию.
export const Route = createFileRoute('/_authed/database/$id')({
  component: () => <CandidateCardPage source="database" />,
});
