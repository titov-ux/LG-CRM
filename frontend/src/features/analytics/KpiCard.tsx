import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: number;
  /** Дельта в процентах (например, 12.5 или −4). */
  delta?: number;
  /** Подпись под дельтой («vs пред. период», «vs год назад»). */
  deltaCaption?: string;
  /**
   * Что считать «хорошим» направлением. Для «закрыто/нанято» рост — хорошо,
   * для «зависших» рост — плохо. Для «open vacancies» направление нейтральное.
   */
  goodDirection?: 'up' | 'down' | 'neutral';
}

export function KpiCard({
  label,
  value,
  delta,
  deltaCaption,
  goodDirection = 'up',
}: KpiCardProps) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const isZero = hasDelta && Math.abs(delta!) < 0.05;
  const isPositive = hasDelta && delta! > 0 && !isZero;
  const isNegative = hasDelta && delta! < 0 && !isZero;

  let tone: 'good' | 'bad' | 'neutral' = 'neutral';
  if (hasDelta && !isZero && goodDirection !== 'neutral') {
    const isGood =
      (goodDirection === 'up' && isPositive) ||
      (goodDirection === 'down' && isNegative);
    tone = isGood ? 'good' : 'bad';
  }

  const toneClass =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'bad'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-muted-foreground';

  const Icon = isZero ? Minus : isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 text-[11.5px] font-medium text-muted-foreground">
          {label}
        </div>
        <div className="flex items-baseline gap-2">
          <div className="tnum text-[26px] font-bold leading-none tracking-tight">
            {value.toLocaleString('ru-RU')}
          </div>
          {hasDelta && (
            <div
              className={cn(
                'tnum inline-flex items-center gap-0.5 text-xs font-semibold',
                toneClass,
              )}
            >
              <Icon className="h-3 w-3" />
              {isZero ? '0%' : `${delta! > 0 ? '+' : ''}${delta!.toFixed(1)}%`}
            </div>
          )}
        </div>
        {deltaCaption && hasDelta && (
          <div className="mt-1.5 text-[10.5px] uppercase tracking-wide text-muted-foreground/70">
            {deltaCaption}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
