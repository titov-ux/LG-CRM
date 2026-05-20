import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { User, UUID } from '@/api/types';
import { useClientNotes, useCreateClientNote } from './hooks';

const NOTE_MAX_LENGTH = 1000;

interface Props {
  clientId: UUID;
  users: User[];
}

export function ClientNotesSection({ clientId, users }: Props) {
  const [text, setText] = useState('');
  const { data: notes, isLoading } = useClientNotes(clientId);
  const createNote = useCreateClientNote(clientId);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    createNote.mutate(
      { text: trimmed },
      {
        onSuccess: () => {
          setText('');
          toast.success('Заметка добавлена');
        },
        onError: () => toast.error('Не удалось добавить заметку'),
      },
    );
  };

  return (
    <div className="min-w-0 space-y-3 overflow-hidden">
      <div className="space-y-2 rounded-md border bg-muted/20 p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX_LENGTH))}
          placeholder="Новая заметка по клиенту…"
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          className="max-h-40 resize-y break-words"
          disabled={createNote.isPending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            ⌘/Ctrl + Enter — сохранить · {text.length}/{NOTE_MAX_LENGTH}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-7"
            disabled={!text.trim() || createNote.isPending}
            onClick={handleSubmit}
          >
            {createNote.isPending ? 'Сохранение…' : 'Добавить'}
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка заметок…</p>}

      {!isLoading && (!notes || notes.length === 0) && (
        <p className="text-sm text-muted-foreground">Заметок пока нет</p>
      )}

      <div className="flex min-w-0 flex-col overflow-hidden">
        {(notes ?? []).map((note, i, arr) => {
          const author = users.find((u) => u.id === note.actorId);
          return (
            <div key={note.id} className="relative flex min-w-0 gap-2.5 pb-3.5 last:pb-0">
              {i < arr.length - 1 && (
                <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
              )}
              <div className="z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border bg-background">
                <MessageCircle className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="text-[13px] leading-5 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {note.text}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  {author && <UserAvatar user={author} size={16} />}
                  <span className="min-w-0 truncate">
                    {author?.fullName ?? '—'} · {new Date(note.createdAt).toLocaleString('ru-RU')}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
