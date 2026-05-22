import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { KanbanStatusDescriptor } from './types';

interface Props<TStatus extends string> {
  statuses: KanbanStatusDescriptor<TStatus>[];
  value: TStatus;
  onValueChange: (status: TStatus) => void;
  disabled?: boolean;
}

export function KanbanStatusSelect<TStatus extends string>({
  statuses,
  value,
  onValueChange,
  disabled,
}: Props<TStatus>) {
  const current = statuses.find((s) => s.id === value);

  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as TStatus)}
      disabled={disabled}
    >
      <SelectTrigger
        className="h-auto w-auto gap-1.5 border-0 bg-muted px-2 py-0.5 text-xs font-medium shadow-none focus:ring-1 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:opacity-60"
        aria-label="Статус на доске"
      >
        {current ? (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: current.color }} />
            {current.label}
          </span>
        ) : (
          <SelectValue placeholder="Статус" />
        )}
      </SelectTrigger>
      <SelectContent>
        {statuses.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
