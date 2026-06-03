import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { vacancyStatuses } from '@/mocks/db/vacancies';
import type { VacancyStatus } from '@/api/types';

interface Props {
  open: boolean;
  /** Целевой финальный статус (для подписи). */
  targetStatus: VacancyStatus | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Подтверждение с обязательным комментарием. */
  onConfirm: (comment: string) => void;
}

const statusLabel = (s: VacancyStatus | null) =>
  vacancyStatuses.find((d) => d.id === s)?.label ?? '';

/**
 * Перевод вакансии в финальный статус (Закрыта / Закрыта успешно) на бэке
 * требует обязательного комментария. Этот диалог собирает его, чтобы и канбан,
 * и карточка вакансии могли закрыть вакансию, а не падать с 422 comment_required.
 */
export function FinalStatusCommentDialog({
  open,
  targetStatus,
  pending = false,
  onOpenChange,
  onConfirm,
}: Props) {
  const [comment, setComment] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setComment('');
      // autofocus после монтирования контента
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  const trimmed = comment.trim();
  const canSubmit = trimmed.length > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            Закрытие вакансии — «{statusLabel(targetStatus)}»
          </DialogTitle>
          <DialogDescription>
            Перевод в финальный статус требует комментария. Опишите итог
            (например, кого вышли, причину закрытия).
          </DialogDescription>
        </DialogHeader>
        <Textarea
          ref={textareaRef}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
          placeholder="Комментарий к закрытию…"
          rows={4}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? 'Сохранение…' : 'Закрыть вакансию'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
