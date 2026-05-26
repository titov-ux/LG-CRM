import { createFileRoute } from '@tanstack/react-router';
import { ResumeFormatterPage } from '@/features/candidates/ResumeFormatterPage';

export const Route = createFileRoute('/_authed/resume-formatter')({
  component: ResumeFormatterPage,
});
