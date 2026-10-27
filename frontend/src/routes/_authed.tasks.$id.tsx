import { createFileRoute } from '@tanstack/react-router';
import { TaskCardPage } from '@/features/tasks/TaskCardPage';

export const Route = createFileRoute('/_authed/tasks/$id')({
  component: TaskCardPage,
});
