/**
 * Модалка «Импорт резюме с hh.ru».
 *
 * Принимает URL вида https://hh.ru/resume/{id} или сам hex-id. Если открыта
 * с `vacancyId` — кандидат сразу прикрепляется к вакансии и попадает в первую
 * колонку канбана. Без vacancyId — просто заводится в /database.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { HTTPError } from 'ky';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UUID } from '@/api/types';
import { useHhImportResume, useHhStatus } from './hooks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancyId?: UUID;
  /** Колбэк после успешного импорта (id созданного кандидата). */
  onImported?: (candidateId: UUID) => void;
}

async function extractError(e: unknown): Promise<string> {
  if (e instanceof HTTPError) {
    try {
      const body = (await e.response.clone().json()) as {
        message?: string;
        code?: string;
      };
      if (body?.message) return body.message;
      if (body?.code) return body.code;
    } catch {
      /* ignore */
    }
  }
  return e instanceof Error ? e.message : 'Неизвестная ошибка';
}

export function HhImportDialog({
  open,
  onOpenChange,
  vacancyId,
  onImported,
}: Props) {
  const [url, setUrl] = useState('');
  const importMut = useHhImportResume();
  const { data: status } = useHhStatus();

  useEffect(() => {
    if (open) setUrl('');
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    try {
      const candidate = await importMut.mutateAsync({
        url: url.trim(),
        vacancyId,
      });
      toast.success(
        vacancyId
          ? `Кандидат «${candidate.fullName}» добавлен на канбан`
          : `Кандидат «${candidate.fullName}» добавлен в базу`,
      );
      onImported?.(candidate.id);
      onOpenChange(false);
    } catch (e) {
      const msg = await extractError(e);
      toast.error('Не удалось импортировать резюме', { description: msg });
    }
  };

  const notConnected = status && !status.connected;

  return (
    <Dialog open={open} onOpenChange={(o) => !importMut.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Импортировать резюме с hh.ru</DialogTitle>
          <DialogDescription>
            Вставьте ссылку на резюме или его ID. Карточка появится{' '}
            {vacancyId ? 'в первой колонке канбана этой вакансии' : 'в базе кандидатов'}.
          </DialogDescription>
        </DialogHeader>

        {notConnected && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            hh.ru не подключён. Откройте Настройки → Интеграции и подключите
            аккаунт работодателя.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="hh-url">Ссылка на резюме hh</Label>
            <Input
              id="hh-url"
              autoFocus
              placeholder="https://hh.ru/resume/abcd1234..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={importMut.isPending || notConnected}
            />
            <p className="text-xs text-muted-foreground">
              Можно вставить как полный URL, так и просто hex-ID резюме.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={importMut.isPending}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={importMut.isPending || !url.trim() || notConnected}
              className="gap-1.5"
            >
              {importMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {importMut.isPending ? 'Импортируем…' : 'Импортировать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
