import { cn } from '@/lib/utils';

interface Props {
  stack: string[];
  max?: number;
  variant?: 'default' | 'accent';
  className?: string;
}

export function StackTags({ stack, max, variant = 'default', className }: Props) {
  const items = max ? stack.slice(0, max) : stack;
  const rest = max ? stack.length - items.length : 0;
  const base =
    variant === 'accent'
      ? 'bg-indigo-50 text-indigo-700'
      : 'bg-muted text-muted-foreground';
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {items.map((s) => (
        <span key={s} className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4', base)}>
          {s}
        </span>
      ))}
      {rest > 0 && (
        <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4', base)}>
          +{rest}
        </span>
      )}
    </div>
  );
}
