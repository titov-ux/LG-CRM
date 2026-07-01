import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { createKanbanCollisionDetection } from './collisionDetection';
import type { KanbanItem, KanbanReorderUpdate, KanbanStatusDescriptor } from './types';
import {
  applyKanbanPreview,
  computeKanbanReorder,
  diffKanbanUpdates,
  getColumnItems,
  getKanbanInsertModifier,
} from './utils';

interface Props<TStatus extends string, TItem extends KanbanItem<TStatus>> {
  statuses: KanbanStatusDescriptor<TStatus>[];
  items: TItem[];
  renderCard: (item: TItem) => ReactNode;
  renderOverlay?: (item: TItem) => ReactNode;
  /**
   * Цвет левого акцента карточки (3px). Используется для маркировки типа
   * сделки (engagementType). Если функция не передана — карточки без полоски.
   */
  getAccentColor?: (item: TItem) => string | undefined;
  onCardClick?: (item: TItem) => void;
  /**
   * Прокидывается на pointerenter карточки. Используем для prefetch'a
   * данных карточки (react-query.prefetchQuery) — за время, что курсор
   * идёт к клику, успеваем прогреть кэш и открытие становится мгновенным.
   */
  onCardHover?: (item: TItem) => void;
  onReorder: (updates: KanbanReorderUpdate<TStatus>[]) => void;
  onCreate?: (status: TStatus) => void;
}

export function KanbanBoard<TStatus extends string, TItem extends KanbanItem<TStatus>>({
  statuses,
  items,
  renderCard,
  renderOverlay,
  getAccentColor,
  onCardClick,
  onCardHover,
  onReorder,
  onCreate,
}: Props<TStatus, TItem>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<TItem[] | null>(null);
  const lastOverKeyRef = useRef<string | null>(null);
  // Мышь: драг стартует после смещения на 4px — обычный клик/скролл не мешает.
  // Тач: драг стартует только после удержания пальца (long-press) 220мс с
  // допуском 8px. Без этого dnd-kit ставит touch-action:none и перехватывает
  // любое движение пальца → канбан невозможно проскроллить на телефоне.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const statusIds = useMemo(() => new Set(statuses.map((s) => s.id)), [statuses]);
  const collisionDetection = useMemo(() => createKanbanCollisionDetection(statusIds), [statusIds]);

  const displayItems = previewItems ?? items;
  const active = items.find((i) => i.id === activeId);

  useEffect(() => {
    if (!activeId) setPreviewItems(null);
  }, [activeId, items]);

  function handleStart(e: DragStartEvent) {
    setActiveId(e.active.id as string);
    setPreviewItems(null);
    lastOverKeyRef.current = null;
  }

  function handleOver(e: DragOverEvent) {
    const { active: dragged, over } = e;
    if (!over) return;

    const overId = over.id as string;
    const modifier = getKanbanInsertModifier(dragged, over);
    const overKey = `${overId}:${modifier}`;
    if (overKey === lastOverKeyRef.current) return;
    lastOverKeyRef.current = overKey;

    const next = applyKanbanPreview(items, statuses, dragged.id as string, overId, modifier);
    const isOriginalLayout = next.every((item) => {
      const orig = items.find((i) => i.id === item.id);
      return orig?.status === item.status && orig?.kanbanOrder === item.kanbanOrder;
    });
    setPreviewItems(isOriginalLayout ? null : (next as TItem[]));
  }

  function handleEnd(e: DragEndEvent) {
    const { active: dragged, over } = e;
    const activeId = dragged.id as string;
    const currentPreview = previewItems;
    const lastOverKey = lastOverKeyRef.current;

    setActiveId(null);
    setPreviewItems(null);
    lastOverKeyRef.current = null;

    if (currentPreview) {
      const updates = diffKanbanUpdates<TItem, TStatus>(items, currentPreview);
      if (updates.length) onReorder(updates);
      return;
    }

    if (!over || activeId === over.id) return;

    const modifier = getKanbanInsertModifier(dragged, over);
    const lastOverId = lastOverKey?.split(':')[0];
    const overId =
      statusIds.has(over.id as TStatus) && lastOverId && lastOverId !== activeId
        ? lastOverId
        : String(over.id);

    const updates = computeKanbanReorder(items, statuses, activeId, overId, modifier);
    if (updates?.length) onReorder(updates);
  }

  function handleCancel() {
    setActiveId(null);
    setPreviewItems(null);
    lastOverKeyRef.current = null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleStart}
      onDragOver={handleOver}
      onDragEnd={handleEnd}
      onDragCancel={handleCancel}
    >
      <div className="flex flex-1 items-start gap-2.5 overflow-x-auto px-6 pb-6 pt-1">
        {statuses.map((status) => {
          const columnItems = getColumnItems(displayItems, status.id);
          return (
            <KanbanColumn
              key={status.id}
              status={status}
              count={columnItems.length}
              itemIds={columnItems.map((i) => i.id)}
              isDragging={!!activeId}
              onCreate={onCreate ? () => onCreate(status.id) : undefined}
            >
              {columnItems.map((item) => (
                <KanbanCard
                  key={item.id}
                  id={item.id}
                  onClick={() => onCardClick?.(item)}
                  onPrefetch={onCardHover ? () => onCardHover(item) : undefined}
                  accentColor={getAccentColor?.(item)}
                >
                  {renderCard(item)}
                </KanbanCard>
              ))}
            </KanbanColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
        {active && (
          <div className="rotate-[1deg] cursor-grabbing rounded-md border bg-background p-2.5 shadow-lg opacity-95">
            {renderOverlay ? renderOverlay(active) : renderCard(active)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
