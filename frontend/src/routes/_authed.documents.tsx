import { createFileRoute } from '@tanstack/react-router';
import { DocumentsPage } from '@/features/documents/DocumentsPage';

export const Route = createFileRoute('/_authed/documents')({
  component: DocumentsPage,
});
