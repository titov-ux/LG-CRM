/**
 * Поле ввода сообщения с автокомплитом @-упоминаний и поддержкой вложений.
 *
 * Когда пользователь печатает `@`, поверх текстарии открывается небольшой
 * комбобокс с участниками диалога. Выбор вставляет токен `<@uuid>` в текст —
 * этот же формат сохраняет бэкенд и понимают парсеры (см. renderMessageText
 * и service.py::_extract_mention_ids).
 *
 * Slack-style @all — первый пункт в combobox-е («all — Все в диалоге»). При
 * выборе вставляется токен `<@all>`; бэк пушит Notification всем участникам
 * диалога кроме автора (с учётом mute).
 *
 * Вложения (Этап 4): кнопка-скрепка и drag&drop в композер. Файлы льются
 * через presign+confirm как в DocumentsPage с временным entity_id, бэк
 * пересвяжет их к сообщению при post_message.
 *
 * Notion-эстетика: список плоский, без рамок, фокусная подсветка серым.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, Send, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { uploadFile, type FileResponse } from '@/api/files';
import { cn } from '@/lib/utils';
import type { User, UUID } from '@/api/types';

/** Sentinel-id для пункта «all» в combobox-е. Не пересекается с UUID. */
const ALL_ID = '__all__' as const;

/** Пункт меню — либо реальный юзер, либо специальный @all. */
type MentionPick =
  | { kind: 'user'; user: User }
  | { kind: 'all' };

interface Props {
  disabled: boolean;
  /** Кандидаты на упоминание — обычно члены диалога без меня. */
  candidates: User[];
  onSend: (args: { text: string; fileIds?: UUID[] }) => void;
}

interface MentionState {
  open: boolean;
  /** Позиция символа `@` в тексте (от которого парсим query). */
  triggerAt: number;
  query: string;
  highlight: number;
}

const INITIAL_MENTION: MentionState = {
  open: false,
  triggerAt: -1,
  query: '',
  highlight: 0,
};

export function Composer({ disabled, candidates, onSend }: Props) {
  const [text, setText] = useState('');
  const [mention, setMention] = useState<MentionState>(INITIAL_MENTION);
  const [attached, setAttached] = useState<FileResponse[]>([]);
  const [uploading, setUploading] = useState<{ name: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // Стабильный entity_id для presign на время «черновика». Бэк пересвяжет
  // вложения к реальному message.id при post_message; этот UUID нужен только
  // чтобы сервер сложил файлы в S3 под предсказуемым префиксом.
  const pendingEntityIdRef = useRef<string>(crypto.randomUUID());

  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Авто-высота textarea (не более ~6 строк).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [text]);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    // Лимит 10 — тот же, что и на бэке.
    const slots = 10 - attached.length - uploading.length;
    const accepted = files.slice(0, Math.max(0, slots));
    if (accepted.length === 0) return;

    setUploading((u) => [...u, ...accepted.map((f) => ({ name: f.name }))]);

    for (const f of accepted) {
      try {
        const rec = await uploadFile({
          entityType: 'chat_message',
          entityId: pendingEntityIdRef.current,
          file: f,
        });
        setAttached((a) => [...a, rec]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('chat: upload failed', err);
      } finally {
        setUploading((u) => {
          const idx = u.findIndex((x) => x.name === f.name);
          if (idx < 0) return u;
          const next = u.slice();
          next.splice(idx, 1);
          return next;
        });
      }
    }
  };

  const filtered = useMemo<MentionPick[]>(() => {
    if (!mention.open) return [];
    const q = mention.query.trim().toLowerCase();
    const active = candidates.filter((u) => u.isActive !== false);
    // @all показываем только если в диалоге кроме меня есть ещё кто-то —
    // иначе нечего адресовать (broadcast «на себя» бессмысленно).
    const allItem: MentionPick[] =
      active.length > 0 && 'all'.startsWith(q) ? [{ kind: 'all' }] : [];
    const users: MentionPick[] = (
      q
        ? active.filter(
            (u) =>
              u.fullName.toLowerCase().includes(q) ||
              u.email.toLowerCase().includes(q),
          )
        : active
    ).map((u) => ({ kind: 'user', user: u }));
    return [...allItem, ...users].slice(0, 8);
  }, [mention, candidates]);

  // Если query больше не матчит никого — закрываем combobox.
  useEffect(() => {
    if (mention.open && filtered.length === 0) {
      setMention(INITIAL_MENTION);
    } else if (mention.open && mention.highlight >= filtered.length) {
      setMention((m) => ({ ...m, highlight: 0 }));
    }
  }, [mention, filtered]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const caret = e.target.selectionStart ?? value.length;
    setText(value);

    // Ищем последний '@' до каретки. Если после него нет пробелов и не
    // обрезалось текущим выделением — открываем combobox.
    const beforeCaret = value.slice(0, caret);
    const atIndex = beforeCaret.lastIndexOf('@');
    if (atIndex < 0) {
      setMention(INITIAL_MENTION);
      return;
    }
    // Условие: либо @ в начале, либо перед ним пробел/перевод строки —
    // иначе это email или просто часть слова.
    const prev = atIndex === 0 ? ' ' : value[atIndex - 1];
    if (!/\s/.test(prev)) {
      setMention(INITIAL_MENTION);
      return;
    }
    const query = beforeCaret.slice(atIndex + 1);
    if (/\s/.test(query)) {
      // Пользователь поставил пробел — упоминание завершилось.
      setMention(INITIAL_MENTION);
      return;
    }
    setMention({ open: true, triggerAt: atIndex, query, highlight: 0 });
  };

  const pickMention = (pick: MentionPick) => {
    const before = text.slice(0, mention.triggerAt);
    const afterCaret = text.slice(
      (ref.current?.selectionStart ?? mention.triggerAt + mention.query.length + 1),
    );
    const token = pick.kind === 'all' ? '<@all> ' : `<@${pick.user.id}> `;
    const next = `${before}${token}${afterCaret}`;
    setText(next);
    setMention(INITIAL_MENTION);
    // Восстановим каретку сразу после вставленного токена.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = (before + token).length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const send = () => {
    const trimmed = text.trim();
    if ((!trimmed && attached.length === 0) || disabled) return;
    if (uploading.length > 0) return; // пока есть незавершённые загрузки — не шлём
    onSend({
      text: trimmed,
      fileIds: attached.length > 0 ? attached.map((f) => f.id) : undefined,
    });
    setText('');
    setMention(INITIAL_MENTION);
    setAttached([]);
    // Новый «черновик» — новый id для следующих вложений.
    pendingEntityIdRef.current = crypto.randomUUID();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.open && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMention((m) => ({
          ...m,
          highlight: Math.min(m.highlight + 1, filtered.length - 1),
        }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMention((m) => ({
          ...m,
          highlight: Math.max(m.highlight - 1, 0),
        }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(filtered[mention.highlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(INITIAL_MENTION);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      className={cn(
        'shrink-0 border-t px-3 py-2.5 transition-colors sm:px-5 sm:py-3',
        dragOver && 'bg-muted/40',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length > 0) void uploadFiles(files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void uploadFiles(files);
          // Сбрасываем, иначе повторный выбор того же файла не сработает.
          if (e.target) e.target.value = '';
        }}
      />

      {(attached.length > 0 || uploading.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attached.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11.5px]"
              title={f.originalName}
            >
              <Paperclip className="h-3 w-3 text-muted-foreground" />
              <span className="max-w-[180px] truncate">{f.originalName}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setAttached((a) => a.filter((x) => x.id !== f.id))
                }
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {uploading.map((u, i) => (
            <span
              key={`up-${i}-${u.name}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11.5px] text-muted-foreground"
            >
              <Paperclip className="h-3 w-3" />
              <span className="max-w-[180px] truncate">{u.name}</span>
              <span className="text-[10px]">загружаем…</span>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        {mention.open && filtered.length > 0 && (
          <div className="absolute bottom-full left-0 z-30 mb-1.5 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border bg-background shadow-md">
            <div className="border-b px-2.5 py-1 text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
              Упомянуть
            </div>
            {filtered.map((item, i) => {
              const isActive = i === mention.highlight;
              const key = item.kind === 'all' ? ALL_ID : item.user.id;
              return (
                <button
                  key={key}
                  type="button"
                  onMouseDown={(e) => {
                    // mousedown, не click — чтобы не сбился фокус textarea.
                    e.preventDefault();
                    pickMention(item);
                  }}
                  onMouseEnter={() =>
                    setMention((m) => ({ ...m, highlight: i }))
                  }
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
                    isActive ? 'bg-muted/70' : 'hover:bg-muted/40',
                  )}
                >
                  {item.kind === 'all' ? (
                    <>
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-100/70 text-amber-900">
                        <Users className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">
                          all
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          Уведомить всех участников диалога
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-[10px] font-medium text-foreground/70">
                        {item.user.initials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">
                          {item.user.fullName}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {item.user.email}
                        </span>
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-md border bg-background px-3 py-2 focus-within:border-foreground/30">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            title="Прикрепить файл"
            disabled={disabled || attached.length + uploading.length >= 10}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Закрываем combobox при потере фокуса, но даём место для
              // mousedown по пункту — onMouseDown сработает раньше.
              setTimeout(() => setMention(INITIAL_MENTION), 100);
            }}
            placeholder="Написать сообщение… (Shift+Enter — новая строка, @ — упомянуть, перетащите файл)"
            className="min-h-0 resize-none border-0 px-0 py-0.5 text-[13.5px] shadow-none focus-visible:ring-0"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={send}
            disabled={
              disabled ||
              uploading.length > 0 ||
              (!text.trim() && attached.length === 0)
            }
            title="Отправить (Enter)"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

