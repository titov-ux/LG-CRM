import type { Priority } from '@/api/types';
import { cn } from '@/lib/utils';

const STYLES: Record<Priority, { label: string; className: string }> = {
  urgent: { label: 'Срочно', className: 'bg-red-100 text-red-700' },
  high: { label: 'Высокий', className: 'bg-amber-100 text-amber-700' },
  medium: { label: 'Средний', className: 'bg-muted text-muted-foreground' },
  low: { label: 'Низкий', className: 'bg-muted text-muted-foreground' },
};

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const s = STYLES[priority];
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium', s.className, className)}>
      {s.label}
    </span>
  );
}
