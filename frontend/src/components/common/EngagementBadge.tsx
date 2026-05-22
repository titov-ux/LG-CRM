import { Briefcase, Users2 } from 'lucide-react';
import type { EngagementType } from '@/api/types';
import { cn } from '@/lib/utils';
import { ENGAGEMENT_META } from '@/lib/engagement';

interface Props {
  type: EngagementType;
  /**
   * 'compact' — короткий код (АС/АГ) для канбан-карточек;
   * 'chip'    — полный лейбл для шапок страниц и форм.
   */
  variant?: 'compact' | 'chip';
  className?: string;
}

/**
 * Бейдж типа сделки (Аутстафф / Кадровое агентство).
 * Используется в карточках канбана и на детальных страницах,
 * чтобы рекрутер с одного взгляда понимал, в каком канале работает запись.
 */
export function EngagementBadge({ type, variant = 'compact', className }: Props) {
  const meta = ENGAGEMENT_META[type];
  const Icon = type === 'outstaff' ? Users2 : Briefcase;
  const title = `Тип: ${meta.label}`;

  if (variant === 'chip') {
    return (
      <span
        title={title}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
          meta.chipClass,
          className,
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
        {meta.label}
      </span>
    );
  }

  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold leading-none',
        meta.badgeClass,
        className,
      )}
      aria-label={title}
    >
      <Icon className="h-2.5 w-2.5" strokeWidth={2.4} />
      {meta.short}
    </span>
  );
}
