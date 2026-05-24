import { useMemo, useState } from 'react';
import { HTTPError } from 'ky';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { ParsedVacancy } from './types';
import { useParseVacancyText } from './hooks';
import { formatDateRu } from '@/lib/utils';

/** Извлекает текст ошибки из ApiError-конверта `{ code, message }`. */
async function extractAiError(e: unknown): Promise<string> {
  if (e instanceof HTTPError) {
    try {
      const body = (await e.response.clone().json()) as
        | { detail?: { code?: string; message?: string }; message?: string }
        | undefined;
      const detail = body?.detail;
      if (detail?.code === 'ai_unavailable') {
        return (
          detail.message ??
          'Сервис AI-распознавания временно недоступен. Заполните поля вручную.'
        );
      }
      if (detail?.message) return detail.message;
      if (body?.message) return body.message;
    } catch {
      // не JSON — fallthrough
    }
    if (e.response.status === 503) {
      return 'Сервис AI-распознавания временно недоступен. Заполните поля вручную.';
    }
    if (e.response.status === 502) {
      return 'Не удалось распознать текст. Проверьте формат и попробуйте снова.';
    }
  }
  return 'Не удалось распознать текст. Проверьте формат и попробуйте снова.';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Применить распарсенные значения к форме. */
  onApply: (parsed: ParsedVacancy) => void;
}

const PRIORITY_LABEL: Record<NonNullable<ParsedVacancy['priority']>, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  urgent: 'Срочно',
};

export function VacancyImportDialog({ open, onOpenChange, onApply }: Props) {
  const [text, setText] = useState('');
  const [analyzed, setAnalyzed] = useState<ParsedVacancy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parseText = useParseVacancyText();

  const detected = useMemo(() => {
    const parsed = analyzed;
    if (!parsed) return [];
    const items: { label: string; value: string }[] = [];
    if (parsed.title) items.push({ label: 'Название', value: parsed.title });
    if (parsed.project) items.push({ label: 'Проект', value: parsed.project });
    if (parsed.grade) items.push({ label: 'Грейд', value: parsed.grade });
    if (parsed.format) items.push({ label: 'Формат', value: parsed.format });
    if (parsed.priority) items.push({ label: 'Приоритет', value: PRIORITY_LABEL[parsed.priority] });
    if (parsed.deadline) items.push({ label: 'Дедлайн', value: formatDateRu(parsed.deadline) });
    if (parsed.rateClient) items.push({ label: 'Ставка клиента', value: `${parsed.rateClient} ₽/ч` });
    if (parsed.stack) items.push({ label: 'Стек', value: parsed.stack });
    if (parsed.requirements) items.push({ label: 'Требования', value: 'распознаны' });
    if (parsed.description) items.push({ label: 'Описание', value: 'распознано' });
    return items;
  }, [analyzed]);

  const reset = () => {
    setText('');
    setAnalyzed(null);
    setError(null);
  };

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setError(null);
    setAnalyzed(null);
    try {
      const { parsed } = await parseText.mutateAsync(text);
      setAnalyzed(parsed);
    } catch (e) {
      setError(await extractAiError(e));
    }
  };

  const handleApply = () => {
    if (!analyzed) return;
    onApply(analyzed);
    onOpenChange(false);
    reset();
  };

  const isPending = parseText.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            AI-распознавание вакансии
          </DialogTitle>
          <DialogDescription>
            Вставьте бриф от клиента «как есть» — нейросеть разложит его по полям формы. Перепроверьте результат перед сохранением.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // если пользователь правит текст после распознавания — сбрасываем результат
            if (analyzed) setAnalyzed(null);
            if (error) setError(null);
          }}
          rows={14}
          placeholder={
            'Например:\n\nИщем Senior Backend (Java) в финтех-компанию\n\nГрейд: Senior\nЛокация: Гибрид (Москва)\nПериод: 6 месяцев\n\nЗадачи на проекте:\n• …\n\nТребования:\n• …'
          }
          className="font-mono text-[13px]"
          disabled={isPending}
        />

        {isPending && (
          <div className="flex items-center gap-2 rounded-md border bg-violet-50 px-3 py-2 text-[12.5px] text-violet-900 dark:bg-violet-950/30 dark:text-violet-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Анализирую текст брифа…
          </div>
        )}

        {!isPending && analyzed && detected.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Распознано
            </div>
            <ul className="space-y-1 text-[12.5px]">
              {detected.map((d) => (
                <li key={d.label} className="flex gap-2">
                  <span className="min-w-[140px] text-muted-foreground">{d.label}</span>
                  <span className="font-medium">{d.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isPending && analyzed && detected.length === 0 && (
          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[12.5px] text-muted-foreground">
            Ничего не удалось распознать. Попробуйте добавить больше контекста: название, грейд, требования.
          </div>
        )}

        {error && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
            {error}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" type="button" onClick={reset} disabled={!text || isPending}>
            Очистить
          </Button>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={isPending}>
            Отмена
          </Button>
          {!analyzed ? (
            <Button type="button" onClick={handleAnalyze} disabled={!text.trim() || isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Анализ…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Анализировать
                </>
              )}
            </Button>
          ) : (
            <Button type="button" onClick={handleApply} disabled={detected.length === 0}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              Применить
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
