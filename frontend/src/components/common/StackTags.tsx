import { cn } from '@/lib/utils';

interface Props {
  stack: string[];
  max?: number;
  variant?: 'default' | 'accent';
  /**
   * Однострочный режим: теги не переносятся, длинные обрезаются `…`,
   * счётчик «+N» всегда видим в конце. Нужен для табличных строк, где важна
   * одинаковая высота (см. CandidatesDatabasePage).
   */
  singleLine?: boolean;
  className?: string;
}

export function StackTags({
  stack,
  max,
  variant = 'default',
  singleLine = false,
  className,
}: Props) {
  const items = max ? stack.slice(0, max) : stack;
  const rest = max ? stack.length - items.length : 0;
  const base =
    variant === 'accent'
      ? 'bg-indigo-50 text-indigo-700'
      : 'bg-muted text-muted-foreground';
  return (
    <div
      className={cn(
        'flex gap-1',
        singleLine ? 'min-w-0 flex-nowrap overflow-hidden' : 'flex-wrap',
        className,
      )}
    >
      {items.map((s) => (
        <span
          key={s}
          className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4',
            base,
            // В однострочном режиме отдельный тег обрезаем с многоточием,
            // shrink разрешён, чтобы счётчик «+N» точно влез в строку.
            singleLine && 'min-w-0 max-w-[88px] truncate',
          )}
          title={singleLine ? s : undefined}
        >
          {s}
        </span>
      ))}
      {rest > 0 && (
        <span
          className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 shrink-0',
            base,
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
