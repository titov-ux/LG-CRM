import { createFileRoute } from '@tanstack/react-router';
import { ScreeningRoomPage } from '@/features/screening/ScreeningRoomPage';

// `video-interviews_` (trailing underscore) — роут НЕ вкладывается в список
// /video-interviews: комната скрининга — отдельная полноэкранная страница.
export const Route = createFileRoute('/_authed/video-interviews_/$id')({
  component: ScreeningRoomPage,
});
