import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Mic, Plus, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { NewScreeningDialog } from '@/features/screening/NewScreeningDialog';
import { useScreenings } from '@/features/screening/hooks';
import type { ScreeningStatus } from '@/api/screenings';

/**
 * Раздел «Видеоинтервью» — список сессий AI-скрининга.
 *
 * Сессия = видеоинтервью в Яндекс Телемосте с записью звука, live-транскриптом
 * (Этап 2), чек-листом вопросов; AI-план и отчёт — на следующих этапах.
 */

const STATUS_LABELS: Record<ScreeningStatus, { label: string; className: string }> = {
  draft: { label: 'Черновик', className: 'bg-muted text-muted-foreground' },
  live: { label: 'Идёт встреча', className: 'bg-red-500/10 text-red-600' },
  processing: { label: 'Анализ…', className: 'bg-amber-500/10 text-amber-600' },
  done: { label: 'Завершён', className: 'bg-emerald-500/10 text-emerald-600' },
  error: { label: 'Ошибка', className: 'bg-red-500/10 text-red-600' },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(sec?: number | null): string | null {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoInterviewsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = useScreenings({ pageSize: 50 }, { pollProcessing: true });
  const items = data?.items ?? [];

  return (
    <div className="flex-1 space-y-4 overflow-auto px-6 pb-8 pt-5">
      {/* Заголовок */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
          <Video className="h-4.5 w-4.5" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Видеоинтервью · AI-скрининг</h1>
          <p className="text-[11.5px] text-muted-foreground">
            Интервью в Яндекс Телемосте с записью, чек-листом вопросов и AI-разбором.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Новый скрининг
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <Card>
          <CardContent className="p-4">
            <EmptyState
              icon={Mic}
              title="Скринингов пока нет"
              description="Создайте сессию, откройте встречу в Телемосте и ведите интервью с записью и чек-листом вопросов."
            />
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {items.map((s) => {
          const st = STATUS_LABELS[s.status];
          const dur = fmtDuration(s.durationSec);
          return (
            <Link
              key={s.id}
              to="/video-interviews/$id"
              params={{ id: s.id }}
              className="block rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">
                      {s.candidateName ?? 'Кандидат'}
                    </span>
                    <Badge variant="secondary" className={st.className}>
                      {st.label}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {s.vacancyTitle ? `${s.vacancyTitle} · ` : ''}
                    {s.recruiterName ? `ведёт ${s.recruiterName} · ` : ''}
                    {fmtDate(s.createdAt)}
                    {dur ? ` · ${dur}` : ''}
                    {s.questions.length ? ` · вопросов: ${s.questions.length}` : ''}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <NewScreeningDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
