import type { CollisionDetection } from '@dnd-kit/core';
import { pointerWithin } from '@dnd-kit/core';

export function createKanbanCollisionDetection(statusIds: Set<string>): CollisionDetection {
  return (args) => {
    const collisions = pointerWithin(args);
    if (collisions.length === 0) return [];

    const card = collisions.find((c) => !statusIds.has(String(c.id)));
    if (card) return [card];

    if (collisions.length === 1) return collisions;

    const pointer = args.pointerCoordinates;
    if (!pointer) return [collisions[0]];

    let best = collisions[0];
    let bestDistance = Infinity;

    for (const collision of collisions) {
      const rect = collision.data?.droppableContainer?.rect.current;
      if (!rect) continue;

      const centerX = rect.left + rect.width / 2;
      const distance = Math.abs(pointer.x - centerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = collision;
      }
    }

    return [best];
  };
}
