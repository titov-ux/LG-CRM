import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  days: number;
  className?: string;
}

// Цветовая логика прототипа: < 7 — зелёный, 7..14 — жёлтый, > 14 — красный.
export function DaysBadge({ days, className }: Props) {
  const color =
    days < 7
      ? 'bg-emerald-100 text-emerald-700'
      : days <= 14
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
  return (
    <span
      className={cn('tnum inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', color, className)}
    >
      <Clock className="h-2.5 w-2.5" strokeWidth={2} />
      {days}д
    </span>
  );
}
