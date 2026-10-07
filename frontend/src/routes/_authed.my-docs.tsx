import { createFileRoute } from '@tanstack/react-router';
import { MyDocsPage } from '@/features/hrEdo/MyDocsPage';

export const Route = createFileRoute('/_authed/my-docs')({
  component: MyDocsPage,
});
