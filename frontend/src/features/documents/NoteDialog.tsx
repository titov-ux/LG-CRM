import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useDocumentsStore } from '@/stores/documents';
import { NoteEditor } from './NoteEditor';
import { EmojiPicker } from './EmojiPicker';
import { SECTIONS } from './mocks';
import type { DocumentItem } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentItem | null;
}

export function NoteDialog({ open, onOpenChange, document }: Props) {
  const updateDocument = useDocumentsStore((s) => s.updateDocument);
  const setEmojiInStore = useDocumentsStore((s) => s.setEmoji);
  const documents = useDocumentsStore((s) => s.documents);

  const fresh = document ? documents.find((d) => d.id === document.id) ?? document : null;
  const section = fresh ? SECTIONS.find((s) => s.id === fresh.section) : undefined;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Когда открываем заметку — подтягиваем актуальные данные
  useEffect(() => {
    if (!open || !fresh) return;
    setTitle(fresh.title);
    setBody(fresh.body ?? '');
    setDirty(false);
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fresh?.id]);

  // Автосейв debounce 500мс
  useEffect(() => {
    if (!fresh || !dirty) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const trimmed = title.trim() || 'Без названия';
      updateDocument(fresh.id, { title: trimmed, body });
      setSavedAt(Date.now());
      setDirty(false);
    }, 500);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, dirty]);

  // При закрытии — финальный flush
  useEffect(() => {
    if (open || !fresh || !dirty) return;
    const trimmed = title.trim() || 'Без названия';
    updateDocument(fresh.id, { title: trimmed, body });
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!fresh) return null;

  const savedLabel = dirty
    ? 'Сохранение…'
    : savedAt
      ? `Сохранено ${new Date(savedAt).toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : 'Все изменения сохранены';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] w-[min(960px,95vw)] max-w-none flex-col gap-0 p-0">
        <DialogTitle className="sr-only">{fresh.title || 'Заметка'}</DialogTitle>
        <DialogDescription className="sr-only">
          Редактор заметки. Изменения сохраняются автоматически.
        </DialogDescription>

        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <EmojiPicker value={fresh.emoji} onSelect={(e) => setEmojiInStore(fresh.id, e)}>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-2xl leading-none transition-colors hover:bg-muted"
              aria-label="Сменить иконку"
            >
              {fresh.emoji}
            </button>
          </EmojiPicker>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-muted-foreground">
              {section ? `${section.emoji} ${section.title}` : 'Заметка'}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {dirty ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              ) : (
                <Check className="h-3 w-3 text-emerald-500" />
              )}
              {savedLabel}
            </div>
          </div>
          {/* spacer чтобы заголовок не упирался в крестик закрытия */}
          <div className="w-8 shrink-0" />
        </div>

        {/* Title + body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            placeholder="Без названия"
            className="border-0 bg-transparent text-[32px] font-bold tracking-tight outline-none placeholder:text-muted-foreground/40"
          />
          <div className="mt-3 flex min-h-0 flex-1 overflow-hidden">
            <NoteEditor
              value={body}
              onChange={(html) => {
                setBody(html);
                setDirty(true);
              }}
              autoFocus={!fresh.body}
              className="flex-1"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
