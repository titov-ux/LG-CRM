import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SECTIONS } from './mocks';
import type { DocumentSectionId } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSection: DocumentSectionId;
  documentTitle: string;
  onSubmit: (section: DocumentSectionId) => void;
}

export function MoveDialog({ open, onOpenChange, currentSection, documentTitle, onSubmit }: Props) {
  const [target, setTarget] = useState<DocumentSectionId>(currentSection);

  useEffect(() => {
    if (open) setTarget(currentSection);
  }, [open, currentSection]);

  const submit = () => {
    if (target !== currentSection) onSubmit(target);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Переместить документ</DialogTitle>
          <DialogDescription className="truncate">«{documentTitle}»</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          {SECTIONS.map((s) => {
            const isCurrent = s.id === currentSection;
            const selected = s.id === target;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setTarget(s.id)}
                disabled={isCurrent}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                  selected
                    ? 'bg-muted text-foreground ring-1 ring-foreground/15'
                    : 'text-foreground hover:bg-muted/60',
                  isCurrent && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                )}
              >
                <span className="text-base leading-none">{s.emoji}</span>
                <span className="flex-1 truncate font-medium">{s.title}</span>
                {isCurrent && <span className="text-[11px] text-muted-foreground">текущий</span>}
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={target === currentSection}>
            Переместить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
