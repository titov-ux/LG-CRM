import { createFileRoute } from '@tanstack/react-router';
import { TenderCardPage } from '@/features/tenders/TenderCardPage';

export const Route = createFileRoute('/_authed/tenders/$id')({
  component: TenderCardPage,
});
