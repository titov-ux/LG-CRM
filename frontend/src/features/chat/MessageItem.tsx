/**
 * Одно сообщение в ленте чата. Поддерживает:
 *  - hover-actions «+эмодзи» / «Изменить» (своё) / «Удалить» (своё/admin);
 *  - inline-edit (Esc отменяет, Enter сохраняет, Shift+Enter — новая строка);
 *  - плейсхолдер «Сообщение удалено» для soft-deleted;
 *  - метку «изменено» по editedAt;
 *  - реакции pills + toggle по клику + EmojiPicker для новой реакции.
 *
 * EmojiPicker переиспользуется из features/documents (см. §6 плана — мы не
 * пишем свой).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  MessageSquare,
  Pencil,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmojiPicker } from '@/features/documents/EmojiPicker';
import {
  useDeleteMessage,
  useToggleReaction,
  useUpdateMessage,
} from './hooks';
import { useChatStore } from './store';
import { renderMessageText } from './renderMessageText';
import { Attachments } from './Attachments';
import { cn } from '@/lib/utils';
import type { ChatMessage, User, UUID } from '@/api/types';

interface Props {
  message: ChatMessage;
  isMine: boolean;
  meId: UUID | null;
  userMap: Map<UUID, User>;
  /** Не показывать бейдж «N ответов» (в шторке треда он не нужен). */
  hideThreadBadge?: boolean;
}

export function MessageItem({
  message,
  isMine,
  meId,
  userMap,
  hideThreadBadge,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const update = useUpdateMessage(message.conversationId);
  const remove = useDeleteMessage(message.conversationId);
  const toggleReaction = useToggleReaction(message.conversationId);
  const openThread = useChatStore((s) => s.openThread);

  if (message.deletedAt) {
    return (
      <div className="space-y-1">
        <div className="text-[13px] italic text-muted-foreground/70">
          Сообщение удалено
        </div>
        {!hideThreadBadge && message.replyCount > 0 && (
          <ThreadBadge
            count={message.replyCount}
            onOpen={() => openThread(message.id)}
          />
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <EditForm
        initial={message.text}
        busy={update.isPending}
        onCancel={() => setEditing(false)}
        onSave={(newText) => {
          if (newText.trim() === message.text.trim()) {
            setEditing(false);
            return;
          }
          update.mutate(
            { messageId: message.id, text: newText.trim() },
            { onSuccess: () => setEditing(false) },
          );
        }}
      />
    );
  }

  const handleToggle = (emoji: string) => {
    toggleReaction.mutate({ messageId: message.id, emoji });
  };

  return (
    <div className="group/msg relative">
      <div className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-foreground/95">
        {renderMessageText(message.text, userMap, { highlightMeId: meId })}
        {message.editedAt && (
          <span className="ml-1.5 text-[10.5px] text-muted-foreground/60">
            (изменено)
          </span>
        )}
      </div>

      {/* Вложения. */}
      {message.attachments.length > 0 && (
        <Attachments files={message.attachments} />
      )}

      {/* Реакции под текстом — pills. */}
      {message.reactions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {message.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => handleToggle(r.emoji)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11.5px] transition-colors',
                r.mineReacted
                  ? 'border-foreground/30 bg-foreground/5'
                  : 'border-transparent bg-muted/60 hover:bg-muted',
              )}
              title={
                r.userIds
                  .map((id) => userMap.get(id)?.fullName ?? 'Кто-то')
                  .join(', ')
              }
            >
              <span className="text-[13px] leading-none">{r.emoji}</span>
              <span className="leading-none text-foreground/70">{r.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Бейдж «N ответов» — только для корневых сообщений в основной ленте. */}
      {!hideThreadBadge && message.replyCount > 0 && (
        <ThreadBadge
          count={message.replyCount}
          onOpen={() => openThread(message.id)}
        />
      )}

      {/* Hover-actions. */}
      <div
        className={cn(
          'absolute right-0 top-0 gap-0.5 rounded-md border bg-background px-1 py-0.5 shadow-sm',
          isReactionPickerOpen ? 'flex' : 'hidden group-hover/msg:flex',
        )}
      >
        <EmojiPicker
          onSelect={(emoji) => handleToggle(emoji)}
          onOpenChange={setIsReactionPickerOpen}
          align="end"
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="Добавить реакцию"
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </Button>
        </EmojiPicker>
        {/* «Ответить в треде» — только для сообщений, которые ещё могут быть
            корнем треда (т.е. не сами в треде). */}
        {!hideThreadBadge && !message.parentMessageId && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="Ответить в треде"
            onClick={() => openThread(message.id)}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
        )}
        {isMine && (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              title="Изменить"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive hover:text-destructive"
              title="Удалить"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm('Удалить сообщение?')) remove.mutate(message.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function EditForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <Textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (text.trim()) onSave(text);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="min-h-0 resize-none border-0 bg-transparent px-0 py-0 text-[13.5px] shadow-none focus-visible:ring-0"
      />
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[10.5px] text-muted-foreground">
          Esc — отмена · Enter — сохранить
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onCancel}
          title="Отмена"
          disabled={busy}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="default"
          className="h-6 w-6"
          onClick={() => text.trim() && onSave(text)}
          disabled={busy || !text.trim()}
          title="Сохранить"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ThreadBadge({
  count,
  onOpen,
}: {
  count: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-[11.5px] font-medium text-foreground/70 transition-colors hover:border-border hover:bg-background"
    >
      <MessageSquare className="h-3 w-3" />
      {count}{' '}
      {pluralizeReplies(count)}
      <span className="ml-1 text-muted-foreground/70">· Перейти в тред</span>
    </button>
  );
}

function pluralizeReplies(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ответ';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ответа';
  return 'ответов';
}
