import { createFileRoute } from '@tanstack/react-router';
import { ClientCardPage } from '@/features/clients/ClientCardPage';

export const Route = createFileRoute('/_authed/clients/$id')({
  component: ClientCardPage,
});
