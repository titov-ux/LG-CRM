import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Mic, Plus, RotateCw, Trash2, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import { useCan } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth';
import { NewScreeningDialog } from '@/features/screening/NewScreeningDialog';
import { useDeleteScreening, useScreenings } from '@/features/screening/hooks';
import type { ScreeningSession, ScreeningStatus } from '@/api/screenings';

/**
 * Раздел «Видеоинтервью» — список сессий AI-скрининга.
 *
 * Сессия = видеоинтервью в Яндекс Телемосте с записью звука, live-транскриптом,
 * чек-листом вопросов и AI-отчётом после встречи.
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

function deleteCopy(status: ScreeningStatus): { title: string; description: string } {
  if (status === 'draft') {
    return {
      title: 'Удалить черновик скрининга?',
      description: 'Черновик будет удалён без возможности восстановления.',
    };
  }
  if (status === 'live') {
    return {
      title: 'Удалить идущую встречу?',
      description: 'Запись и данные будут удалены безвозвратно.',
    };
  }
  return {
    title: 'Удалить интервью?',
    description: 'Запись, транскрипт и отчёт будут удалены безвозвратно.',
  };
}

export function VideoInterviewsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ScreeningSession | null>(null);
  const canRun = useCan('screening:run');
  const canViewReport = useCan('screening:view_report');
  const canSeeList = canRun || canViewReport;
  const me = useAuthStore((s) => s.user);
  /** Бэк даёт менять сессию только ведущему рекрутеру и админу (иначе 403). */
  const isOwner = (recruiterId?: string | null) =>
    recruiterId === me?.id || me?.role === 'admin';
  const { data, isLoading, isError, refetch, isRefetching } = useScreenings(
    { pageSize: 50 },
    { pollProcessing: canSeeList },
  );
  const deleteSession = useDeleteScreening();
  const items = data?.items ?? [];
  const deleteTexts = toDelete ? deleteCopy(toDelete.status) : null;

  async function handleDeleteConfirm() {
    if (!toDelete) return;
    const status = toDelete.status;
    try {
      await deleteSession.mutateAsync(toDelete.id);
      setToDelete(null);
      toast.success(status === 'draft' ? 'Черновик удалён' : 'Интервью удалено');
    } catch {
      toast.error(
        status === 'draft' ? 'Не удалось удалить черновик' : 'Не удалось удалить интервью',
      );
    }
  }

  if (!canSeeList) {
    return (
      <div className="flex-1 space-y-4 overflow-auto px-6 pb-8 pt-5">
        <Card>
          <CardContent className="p-4">
            <EmptyState
              icon={Video}
              title="Раздел недоступен"
              description="У вашей роли нет доступа к AI-скринингу. Обратитесь к администратору, если он нужен для работы."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-auto px-6 pb-8 pt-5">
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
        {canRun && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Новый скрининг
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-muted-foreground/60" />
            <div className="text-[13px] font-medium">Не удалось загрузить список скринингов</div>
            <p className="text-[12px] text-muted-foreground">
              Проверьте соединение и попробуйте ещё раз.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isRefetching}
            >
              <RotateCw className={cn('mr-1.5 h-3.5 w-3.5', isRefetching && 'animate-spin')} />
              Повторить
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && items.length === 0 && (
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
        {!isError &&
          items.map((s) => {
          const st = STATUS_LABELS[s.status];
          const dur = fmtDuration(s.durationSec);
          return (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <Link
                to="/video-interviews/$id"
                params={{ id: s.id }}
                className="min-w-0 flex-1"
              >
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
              </Link>
              {canRun && isOwner(s.recruiterId) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  title={s.status === 'draft' ? 'Удалить черновик' : 'Удалить интервью'}
                  disabled={deleteSession.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setToDelete(s);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {canRun && <NewScreeningDialog open={createOpen} onOpenChange={setCreateOpen} />}

      <Dialog
        open={!!toDelete}
        onOpenChange={(o) => !deleteSession.isPending && !o && setToDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{deleteTexts?.title}</DialogTitle>
            <DialogDescription>{deleteTexts?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setToDelete(null)}
              disabled={deleteSession.isPending}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleteSession.isPending}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {deleteSession.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
