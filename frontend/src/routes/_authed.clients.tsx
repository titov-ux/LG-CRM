import { Outlet, createFileRoute } from '@tanstack/react-router';
import { ClientsListPage } from '@/features/clients/ClientsListPage';

export const Route = createFileRoute('/_authed/clients')({
  component: () => (
    <>
      <ClientsListPage />
      <Outlet />
    </>
  ),
});
