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
import type { LeadStatus } from '@/api/types';
import { leadStatuses } from './statuses';

interface Props {
  open: boolean;
  targetStatus: LeadStatus | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (comment: string) => void;
}

const statusLabel = (s: LeadStatus | null) =>
  leadStatuses.find((d) => d.id === s)?.label ?? '';

/**
 * Перевод лида в финальный статус (Сделка / Отказ) на бэке требует
 * обязательного комментария. Диалог собирает его — чтобы канбан не падал с
 * 422 comment_required.
 */
export function LeadFinalStatusDialog({
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
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  const trimmed = comment.trim();
  const canSubmit = trimmed.length > 0 && !pending;
  const isWon = targetStatus === 'won';

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            Лид — «{statusLabel(targetStatus)}»
          </DialogTitle>
          <DialogDescription>
            {isWon
              ? 'Опишите итог: условия сделки, сумму, следующие шаги.'
              : 'Укажите причину отказа: не устроила цена, ушли к конкуренту, нет потребности…'}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          ref={textareaRef}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
          placeholder="Комментарий…"
          rows={4}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? 'Сохранение…' : isWon ? 'Закрыть сделкой' : 'Отметить отказ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
