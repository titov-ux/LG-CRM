import { createFileRoute } from '@tanstack/react-router';
import { CalculatorPage } from '@/features/calculator/CalculatorPage';

export const Route = createFileRoute('/_authed/calculator')({
  component: CalculatorPage,
});
