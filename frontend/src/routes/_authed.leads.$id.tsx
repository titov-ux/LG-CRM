import { createFileRoute } from '@tanstack/react-router';
import { LeadCardPage } from '@/features/leads/LeadCardPage';

export const Route = createFileRoute('/_authed/leads/$id')({
  component: LeadCardPage,
});
