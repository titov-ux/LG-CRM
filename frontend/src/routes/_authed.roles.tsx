import { createFileRoute } from '@tanstack/react-router';
import { RolesPage } from '@/features/users/RolesPage';

export const Route = createFileRoute('/_authed/roles')({
  component: RolesPage,
});
