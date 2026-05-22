import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanStatusDescriptor } from './types';

interface Props<TStatus extends string> {
  status: KanbanStatusDescriptor<TStatus>;
  itemIds: string[];
  count: number;
  children: ReactNode;
  isDragging?: boolean;
  onCreate?: () => void;
}

export function KanbanColumn<TStatus extends string>({
  status,
  itemIds,
  count,
  children,
  isDragging = false,
  onCreate,
}: Props<TStatus>) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        '-mx-1.5 w-[calc(280px+12px)] shrink-0 rounded-lg p-1 px-1.5 transition-colors',
        isOver && isDragging && 'bg-muted/60',
      )}
    >
      <div className="flex items-center justify-between px-2 pb-2.5 pt-1.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: status.color }} />
          <span className="text-[13px] font-semibold tracking-tight">{status.label}</span>
          <span className="tnum text-xs text-muted-foreground">{count}</span>
        </div>
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1.5">{children}</div>
      </SortableContext>
    </div>
  );
}
