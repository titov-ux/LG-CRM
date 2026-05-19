import { createFileRoute } from '@tanstack/react-router';
import { ContactsListPage } from '@/features/contacts/ContactsListPage';

export const Route = createFileRoute('/_authed/contacts')({
  component: ContactsListPage,
});
