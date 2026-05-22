import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

interface Props {
  id: string;
  onClick?: () => void;
  /**
   * Цвет левого акцента карточки (3px). Используется для маркировки типа
   * сделки (см. EngagementBadge / lib/engagement). Если не передан — без полоски.
   */
  accentColor?: string;
  children: ReactNode;
}

export function KanbanCard({ id, onClick, accentColor, children }: Props) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="min-h-[88px] rounded-md border-2 border-dashed border-primary/45 bg-primary/[0.04] transition-all"
        aria-hidden
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'group relative cursor-grab overflow-hidden rounded-md border bg-background p-2.5 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition-all hover:border-slate-300 hover:shadow-[0_2px_4px_rgba(15,23,42,0.04)] active:cursor-grabbing',
      )}
    >
      {accentColor && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
          style={{ background: accentColor }}
        />
      )}
      {children}
    </div>
  );
}
