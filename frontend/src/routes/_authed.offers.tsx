import { createFileRoute } from '@tanstack/react-router';
import { OffersPage } from '@/features/offers/OffersPage';

export const Route = createFileRoute('/_authed/offers')({
  component: OffersPage,
});
