import { useMemo, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SECTIONS } from './mocks';
import { TEMPLATES } from './templates';
import type { DocumentSectionId, DocumentTemplate } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (t: DocumentTemplate) => void;
}

export function TemplatesDialog({ open, onOpenChange, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<DocumentSectionId | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter((t) => {
      if (activeSection !== 'all' && t.section !== activeSection) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [query, activeSection]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Создать из шаблона
          </DialogTitle>
          <DialogDescription>
            Готовые заготовки для типовых документов — выберите и подправьте под свой случай.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти шаблон…"
              className="h-9 pl-8"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          <SectionChip
            label="Все"
            emoji="📚"
            selected={activeSection === 'all'}
            onClick={() => setActiveSection('all')}
          />
          {SECTIONS.map((s) => (
            <SectionChip
              key={s.id}
              label={s.title}
              emoji={s.emoji}
              selected={activeSection === s.id}
              onClick={() => setActiveSection(s.id)}
            />
          ))}
        </div>

        <div className="grid max-h-[440px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {filtered.length === 0 ? (
            <div className="col-span-full py-12 text-center text-[12px] text-muted-foreground">
              Шаблоны не найдены
            </div>
          ) : (
            filtered.map((t) => {
              const section = SECTIONS.find((s) => s.id === t.section);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onPick(t);
                    onOpenChange(false);
                  }}
                  className="group flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40"
                >
                  <span className="text-2xl leading-none">{t.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold">{t.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                      {t.description}
                    </div>
                    {section && (
                      <div className="mt-1.5 text-[11px] text-muted-foreground/80">
                        {section.emoji} {section.title}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionChip({
  label,
  emoji,
  selected,
  onClick,
}: {
  label: string;
  emoji: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
        selected
          ? 'bg-foreground text-background'
          : 'bg-muted text-muted-foreground hover:bg-muted/70',
      )}
    >
      <span className="text-sm leading-none">{emoji}</span>
      {label}
    </button>
  );
}
