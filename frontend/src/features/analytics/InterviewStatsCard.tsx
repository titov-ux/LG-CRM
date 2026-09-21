import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarCheck, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InterviewStatsResponse, TrendsParams } from '@/api/analytics';
import { cn } from '@/lib/utils';
import { useInterviewStats } from './hooks';

interface SeriesDef {
  key: keyof InterviewStatsResponse['series'];
  label: string;
  color: string;
}

const SERIES: SeriesDef[] = [
  { key: 'scheduled', label: 'Назначены', color: '#8b5cf6' },
  { key: 'held', label: 'Проведены', color: '#10b981' },
];

const WIDTH = 760;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 28, left: 36 };

function formatTick(
  iso: string,
  granularity: 'day' | 'week' | 'month',
): string {
  const d = new Date(iso);
  if (granularity === 'month') return format(d, 'LLL yy', { locale: ru });
  return format(d, 'd MMM', { locale: ru });
}

interface InterviewStatsCardProps {
  params: TrendsParams;
}

export function InterviewStatsCard({ params }: InterviewStatsCardProps) {
  const { data, isLoading } = useInterviewStats(params);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const buckets = data.series.scheduled.map((p) => p.bucket);
    const n = buckets.length;
    if (n === 0) return null;

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
        x: x(i),
        y: y(p.value),
        v: p.value,
      }));
      const path = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
        .join(' ');
      const area =
        pts.length > 1
          ? `${path} L${pts[pts.length - 1].x.toFixed(2)},${(
              PADDING.top + innerH
            ).toFixed(2)} L${pts[0].x.toFixed(2)},${(
              PADDING.top + innerH
            ).toFixed(2)} Z`
          : null;
      return { ...s, pts, path, area };
    });

    const gridY = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      y: PADDING.top + innerH * (1 - t),
      label: Math.round(max * t),
    }));

    const tickStep = Math.max(1, Math.ceil(n / 7));

    return { buckets, lines, gridY, x, tickStep, n, innerW, innerH };
  }, [data, hidden]);

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !view) return;
    const rect = svg.getBoundingClientRect();
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

  const hoverX = hoverIdx !== null && view ? view.x(hoverIdx) : null;
  const hoverBucket =
    hoverIdx !== null && view ? view.buckets[hoverIdx] : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Собеседования</CardTitle>
        {data && (
          <div className="flex items-center gap-4 text-[11.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-violet-500" />
              Назначены:{' '}
              <span className="tnum font-semibold text-foreground">
                {data.totals.scheduled}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
              Проведены:{' '}
              <span className="tnum font-semibold text-foreground">
                {data.totals.held}
              </span>
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[220px] animate-pulse rounded-md bg-muted/40" />
        ) : !data || !view ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            Нет данных за выбранный период
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative w-full">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="w-full"
                onMouseMove={onMouseMove}
                onMouseLeave={() => setHoverIdx(null)}
              >
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
                      {formatTick(b, data.granularity)}
                    </text>
                  );
                })}

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

                {view.lines.map((line) => {
                  if (hidden.has(line.key)) return null;
                  return (
                    <g key={line.key}>
                      {line.area && (
                        <path d={line.area} fill={line.color} fillOpacity={0.06} />
                      )}
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
                          <span className="tnum ml-auto pl-3 font-semibold">{v}</span>
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
        )}
      </CardContent>
    </Card>
  );
}
