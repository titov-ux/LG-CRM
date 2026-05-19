import { createFileRoute } from '@tanstack/react-router';
import { CandidateCardPage } from '@/features/candidates/CandidateCardPage';

export const Route = createFileRoute('/_authed/candidates/$id')({
  component: CandidateCardPage,
});
