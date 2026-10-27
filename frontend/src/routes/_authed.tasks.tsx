import { Outlet, createFileRoute } from '@tanstack/react-router';
import { TasksKanbanPage } from '@/features/tasks/TasksKanbanPage';

export const Route = createFileRoute('/_authed/tasks')({
  component: () => (
    <>
      <TasksKanbanPage />
      <Outlet />
    </>
  ),
});
