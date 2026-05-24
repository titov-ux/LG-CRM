import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { TrendsResponse } from '@/api/analytics';
import { cn } from '@/lib/utils';

interface SeriesDef {
  key: keyof TrendsResponse['series'];
  label: string;
  color: string;
}

const SERIES: SeriesDef[] = [
  { key: 'vacanciesCreated', label: 'Создано вакансий', color: '#3b82f6' },
  { key: 'vacanciesClosed', label: 'Закрыто вакансий', color: '#10b981' },
  { key: 'candidatesCreated', label: 'Кандидаты заведены', color: '#a855f7' },
  { key: 'hires', label: 'Наймы', color: '#f59e0b' },
];

interface TrendsChartProps {
  data: TrendsResponse | undefined;
  isLoading?: boolean;
}

const WIDTH = 760;
const HEIGHT = 240;
const PADDING = { top: 16, right: 16, bottom: 28, left: 36 };

function formatTickByGranularity(
  iso: string,
  granularity: 'day' | 'week' | 'month',
): string {
  const d = new Date(iso);
  if (granularity === 'month') return format(d, 'LLL yy', { locale: ru });
  if (granularity === 'week') return format(d, 'd MMM', { locale: ru });
  return format(d, 'd MMM', { locale: ru });
}

export function TrendsChart({ data, isLoading }: TrendsChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const buckets = data.series.vacanciesCreated.map((p) => p.bucket);
    const n = buckets.length;
    if (n === 0) return null;

    // максимум по всем видимым сериям
    const visible = SERIES.filter((s) => !hidden.has(s.key));
    const max = Math.max(
      1,
      ...visible.flatMap((s) => data.series[s.key].map((p) => p.value)),
    );

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const stepX = n > 1 ? innerW / (n - 1) : 0;

    const x = (i: number) => PADDING.left + i * stepX;
    const y = (v: number) => PADDING.top + innerH - (v / max) * innerH;

    const lines = SERIES.map((s) => {
      const pts = data.series[s.key].map((p, i) => ({
        i,
        x: x(i),
        y: y(p.value),
        v: p.value,
        b: p.bucket,
      }));
      const path = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
        .join(' ');
      return { ...s, pts, path };
    });

    // 4 горизонтальные линии-сетки
    const gridY = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      y: PADDING.top + innerH * (1 - t),
      label: Math.round(max * t),
    }));

    // x-tick шаг (показать ~6 подписей)
    const tickStep = Math.max(1, Math.ceil(n / 7));

    return { buckets, max, lines, gridY, x, tickStep, n, innerW, innerH };
  }, [data, hidden]);

  if (isLoading) {
    return (
      <div className="h-[240px] animate-pulse rounded-md bg-muted/40" />
    );
  }
  if (!data || !view) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
        Нет данных за выбранный период
      </div>
    );
  }

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // приводим клиентскую координату к viewBox-координате
    const xVB = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const innerX = xVB - PADDING.left;
    const stepX = view.n > 1 ? view.innerW / (view.n - 1) : 0;
    if (stepX === 0) {
      setHoverIdx(0);
      return;
    }
    const idx = Math.round(innerX / stepX);
    if (idx >= 0 && idx < view.n) setHoverIdx(idx);
    else setHoverIdx(null);
  };

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const hoverX = hoverIdx !== null ? view.x(hoverIdx) : null;
  const hoverBucket =
    hoverIdx !== null ? view.buckets[hoverIdx] : null;

  return (
    <div className="space-y-2">
      <div className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* сетка */}
          {view.gridY.map((g, i) => (
            <g key={i}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={g.y}
                y2={g.y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 6}
                y={g.y + 3}
                textAnchor="end"
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.5}
                className="tnum"
              >
                {g.label}
              </text>
            </g>
          ))}

          {/* x-метки */}
          {view.buckets.map((b, i) => {
            if (i % view.tickStep !== 0 && i !== view.n - 1) return null;
            return (
              <text
                key={i}
                x={view.x(i)}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.55}
              >
                {formatTickByGranularity(b, data.granularity)}
              </text>
            );
          })}

          {/* hover guideline */}
          {hoverX !== null && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="currentColor"
              strokeOpacity={0.18}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* линии */}
          {view.lines.map((line) => {
            if (hidden.has(line.key)) return null;
            return (
              <g key={line.key}>
                <path
                  d={line.path}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {hoverIdx !== null && line.pts[hoverIdx] && (
                  <circle
                    cx={line.pts[hoverIdx].x}
                    cy={line.pts[hoverIdx].y}
                    r={3.5}
                    fill="white"
                    stroke={line.color}
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {hoverIdx !== null && hoverBucket && (
          <div
            className="pointer-events-none absolute top-2 rounded-md border bg-popover/95 px-2.5 py-1.5 text-[11.5px] shadow-md backdrop-blur"
            style={{
              left: `${(view.x(hoverIdx) / WIDTH) * 100}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="mb-1 font-medium text-muted-foreground">
              {format(new Date(hoverBucket), 'd MMMM yyyy', { locale: ru })}
            </div>
            <div className="space-y-0.5">
              {SERIES.map((s) => {
                if (hidden.has(s.key)) return null;
                const v = data.series[s.key][hoverIdx]?.value ?? 0;
                return (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="text-foreground/80">{s.label}</span>
                    <span className="tnum ml-auto font-semibold">{v}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {SERIES.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              className={cn(
                'inline-flex items-center gap-1.5 text-[11.5px] transition',
                off ? 'opacity-40 hover:opacity-70' : 'opacity-100',
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
