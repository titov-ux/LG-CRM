import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-12 text-center', className)}>
      <Icon className="h-8 w-8 text-muted-foreground/50" strokeWidth={1.5} />
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="max-w-xs text-xs text-muted-foreground">{description}</div>}
    </div>
  );
}
