import { createFileRoute } from '@tanstack/react-router';
import { ContactCardPage } from '@/features/contacts/ContactCardPage';

export const Route = createFileRoute('/_authed/contacts/$id')({
  component: ContactCardPage,
});
