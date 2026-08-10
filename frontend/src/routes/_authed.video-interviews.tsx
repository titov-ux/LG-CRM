import { createFileRoute } from '@tanstack/react-router';
import { VideoInterviewsPage } from '@/features/videoInterviews/VideoInterviewsPage';

export const Route = createFileRoute('/_authed/video-interviews')({
  component: VideoInterviewsPage,
});
