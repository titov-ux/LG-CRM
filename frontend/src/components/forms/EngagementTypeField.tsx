import { Briefcase, Users2 } from 'lucide-react';
import type { EngagementType } from '@/api/types';
import { ENGAGEMENT_OPTIONS } from '@/lib/engagement';
import { cn } from '@/lib/utils';

interface Props {
  value: EngagementType | undefined;
  onChange: (value: EngagementType) => void;
  /** Если true — поле отключено, используется в read-only режимах. */
  disabled?: boolean;
}

/**
 * Сегментированный выбор типа сделки (аутстафф / агентство).
 * Используется в формах вакансии и кандидата.
 *
 * Решено не наследовать тип от клиента — рекрутер всегда выбирает руками,
 * чтобы случайно не утащить в неправильный канал.
 */
export function EngagementTypeField({ value, onChange, disabled }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Тип сделки">
      {ENGAGEMENT_OPTIONS.map((opt) => {
        const Icon = opt.id === 'outstaff' ? Users2 : Briefcase;
        const isActive = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn(
              'group flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? opt.id === 'outstaff'
                  ? 'border-blue-400 bg-blue-50/60 ring-1 ring-blue-300/60 dark:border-blue-500/60 dark:bg-blue-950/40 dark:ring-blue-900/50'
                  : 'border-amber-400 bg-amber-50/60 ring-1 ring-amber-300/60 dark:border-amber-500/60 dark:bg-amber-950/40 dark:ring-amber-900/50'
                : 'hover:border-slate-300 hover:bg-muted/30 dark:hover:border-slate-600',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <Icon
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                isActive
                  ? opt.id === 'outstaff'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground',
              )}
              strokeWidth={2}
            />
            <span className="text-[13px] font-medium leading-none">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
