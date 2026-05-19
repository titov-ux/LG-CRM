import { type ReactNode, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import type { KanbanItem, KanbanStatusDescriptor } from './types';

interface Props<TStatus extends string, TItem extends KanbanItem<TStatus>> {
  statuses: KanbanStatusDescriptor<TStatus>[];
  items: TItem[];
  renderCard: (item: TItem) => ReactNode;
  renderOverlay?: (item: TItem) => ReactNode;
  onCardClick?: (item: TItem) => void;
  onStatusChange: (id: string, status: TStatus) => void;
  onCreate?: (status: TStatus) => void;
}

export function KanbanBoard<TStatus extends string, TItem extends KanbanItem<TStatus>>({
  statuses,
  items,
  renderCard,
  renderOverlay,
  onCardClick,
  onStatusChange,
  onCreate,
}: Props<TStatus, TItem>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const active = items.find((i) => i.id === activeId);

  function handleStart(e: DragStartEvent) {
    setActiveId(e.active.id as string);
  }

  function handleEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over) return;
    const overId = e.over.id as string;
    const target =
      statuses.find((s) => s.id === overId)?.id ??
      items.find((i) => i.id === overId)?.status ??
      null;
    if (!target) return;
    const dragged = items.find((i) => i.id === e.active.id);
    if (!dragged || dragged.status === target) return;
    onStatusChange(dragged.id, target as TStatus);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleStart} onDragEnd={handleEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex flex-1 items-start gap-2.5 overflow-x-auto px-6 pb-6 pt-1">
        {statuses.map((status) => {
          const columnItems = items.filter((i) => i.status === status.id);
          return (
            <KanbanColumn
              key={status.id}
              status={status}
              count={columnItems.length}
              itemIds={columnItems.map((i) => i.id)}
              onCreate={onCreate ? () => onCreate(status.id) : undefined}
            >
              {columnItems.map((item) => (
                <KanbanCard key={item.id} id={item.id} onClick={() => onCardClick?.(item)}>
                  {renderCard(item)}
                </KanbanCard>
              ))}
            </KanbanColumn>
          );
        })}
      </div>

      <DragOverlay>
        {active && (
          <div className="rounded-md border bg-background p-2.5 shadow-md opacity-95">
            {renderOverlay ? renderOverlay(active) : renderCard(active)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
