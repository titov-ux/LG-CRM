import type { Active, Over } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { KanbanItem, KanbanReorderUpdate, KanbanStatusDescriptor } from './types';

export type KanbanInsertModifier = 0 | 1;

export function getKanbanInsertModifier(active: Active, over: Over | null): KanbanInsertModifier {
  if (!over?.rect) return 0;
  const translated = active.rect.current.translated ?? active.rect.current.initial;
  if (!translated) return 0;
  const activeMidY = translated.top + translated.height / 2;
  const overMidY = over.rect.top + over.rect.height / 2;
  return activeMidY > overMidY ? 1 : 0;
}

export function sortByKanbanOrder<T extends KanbanItem<string>>(items: T[]): T[] {
  return [...items].sort((a, b) => a.kanbanOrder - b.kanbanOrder);
}

export function getColumnItems<T extends KanbanItem<TStatus>, TStatus extends string>(
  items: T[],
  statusId: TStatus,
): T[] {
  return sortByKanbanOrder(items.filter((i) => i.status === statusId));
}

export function resolveColumnId<T extends KanbanItem<TStatus>, TStatus extends string>(
  overId: string,
  items: T[],
  statuses: KanbanStatusDescriptor<TStatus>[],
): TStatus | null {
  if (statuses.some((s) => s.id === overId)) return overId as TStatus;
  return items.find((i) => i.id === overId)?.status ?? null;
}

function resolveSameColumnIndex(
  oldIndex: number,
  overIndex: number,
  modifier: KanbanInsertModifier,
  columnLength: number,
): number {
  let newIndex = overIndex + modifier;
  newIndex = Math.max(0, Math.min(newIndex, columnLength - 1));
  if (oldIndex < newIndex) newIndex -= 1;
  return newIndex;
}

export function computeKanbanReorder<T extends KanbanItem<TStatus>, TStatus extends string>(
  items: T[],
  statuses: KanbanStatusDescriptor<TStatus>[],
  activeId: string,
  overId: string,
  modifier: KanbanInsertModifier = 0,
): KanbanReorderUpdate<TStatus>[] | null {
  const dragged = items.find((i) => i.id === activeId);
  if (!dragged) return null;

  const activeColumn = dragged.status;
  const overColumn = resolveColumnId(overId, items, statuses);
  if (!overColumn) return null;

  const updates: KanbanReorderUpdate<TStatus>[] = [];

  if (activeColumn === overColumn) {
    const columnItems = getColumnItems(items, activeColumn);
    const oldIndex = columnItems.findIndex((i) => i.id === activeId);
    let newIndex: number;
    if (statuses.some((s) => s.id === overId)) {
      newIndex = columnItems.length - 1;
    } else {
      const overIndex = columnItems.findIndex((i) => i.id === overId);
      if (overIndex === -1) return null;
      newIndex = resolveSameColumnIndex(oldIndex, overIndex, modifier, columnItems.length);
    }

    if (oldIndex === -1 || oldIndex === newIndex) return null;

    const reordered = arrayMove(columnItems, oldIndex, newIndex);
    reordered.forEach((item, idx) => {
      updates.push({ id: item.id, status: activeColumn, kanbanOrder: idx });
    });
    return updates;
  }

  const sourceItems = getColumnItems(items, activeColumn).filter((i) => i.id !== activeId);
  const destItems = getColumnItems(items, overColumn);
  let insertIndex: number;
  if (statuses.some((s) => s.id === overId)) {
    insertIndex = destItems.length;
  } else {
    const overIndex = destItems.findIndex((i) => i.id === overId);
    insertIndex = overIndex === -1 ? destItems.length : overIndex + modifier;
  }
  insertIndex = Math.max(0, Math.min(insertIndex, destItems.length));

  const newDestItems = [...destItems];
  newDestItems.splice(insertIndex, 0, { ...dragged, status: overColumn });

  sourceItems.forEach((item, idx) => {
    updates.push({ id: item.id, status: activeColumn, kanbanOrder: idx });
  });
  newDestItems.forEach((item, idx) => {
    updates.push({ id: item.id, status: overColumn, kanbanOrder: idx });
  });

  return updates;
}

export function applyKanbanPreview<T extends KanbanItem<TStatus>, TStatus extends string>(
  items: T[],
  statuses: KanbanStatusDescriptor<TStatus>[],
  activeId: string,
  overId: string,
  modifier: KanbanInsertModifier = 0,
): T[] {
  if (activeId === overId) return items;

  const updates = computeKanbanReorder(items, statuses, activeId, overId, modifier);
  if (!updates) return items;

  const updateMap = new Map(updates.map((u) => [u.id, u]));
  return items.map((item) => {
    const update = updateMap.get(item.id);
    return update ? { ...item, status: update.status, kanbanOrder: update.kanbanOrder } : item;
  });
}

export function diffKanbanUpdates<
  T extends KanbanItem<TStatus>,
  TStatus extends string = T['status'],
>(original: T[], preview: T[]): KanbanReorderUpdate<TStatus>[] {
  const origMap = new Map(original.map((i) => [i.id, i]));
  const updates: KanbanReorderUpdate<TStatus>[] = [];

  for (const item of preview) {
    const orig = origMap.get(item.id);
    if (!orig) continue;
    if (orig.status !== item.status || orig.kanbanOrder !== item.kanbanOrder) {
      updates.push({ id: item.id, status: item.status, kanbanOrder: item.kanbanOrder });
    }
  }

  return updates;
}

export function assignKanbanOrders<T extends { status: string }>(items: T[]): (T & { kanbanOrder: number })[] {
  const counters: Partial<Record<string, number>> = {};
  return items.map((item) => {
    const order = counters[item.status] ?? 0;
    counters[item.status] = order + 1;
    return { ...item, kanbanOrder: order };
  });
}
