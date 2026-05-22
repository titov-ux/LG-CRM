import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { User } from '@/api/types';
import { cn } from '@/lib/utils';

/**
 * Максимальная длина комментария — должна совпадать с лимитом валидации
 * в MSW-эндпоинте POST/PATCH /comments. При переезде на боевой бэкенд —
 * привести в соответствие с ограничением колонки в БД.
 */
export const COMMENT_MAX_LENGTH = 2000;
/** Начиная с этого порога счётчик подсвечивается жёлтым. */
const COMMENT_WARN_THRESHOLD = COMMENT_MAX_LENGTH - 200;

interface Props {
  /** Список пользователей для @ упоминаний */
  users: User[];
  /** Начальное значение (для режима редактирования) */
  initialValue?: string;
  /** Список уже упомянутых id (для предзаполнения mentions при редактировании) */
  initialMentions?: string[];
  placeholder?: string;
  submitLabel?: string;
  isPending?: boolean;
  autoFocus?: boolean;
  /** Показывать кнопку «Отмена» (для ответа/редактирования) */
  showCancel?: boolean;
  onCancel?: () => void;
  /** Отправка: текст и массив id упомянутых пользователей */
  onSubmit: (text: string, mentions: string[]) => void;
}

/**
 * Композер комментария с поддержкой @ упоминаний.
 * При вводе `@` под текстареей открывается список пользователей —
 * стрелками/Enter выбираем, в текст вставляется `@Имя`, а id попадает в mentions[].
 */
export function CommentComposer({
  users,
  initialValue = '',
  initialMentions = [],
  placeholder = 'Написать комментарий…',
  submitLabel = 'Отправить',
  isPending = false,
  autoFocus = false,
  showCancel = false,
  onCancel,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [mentions, setMentions] = useState<string[]>(initialMentions);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number>(-1);
  const [highlight, setHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const filteredUsers = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return users.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, users]);

  useEffect(() => {
    if (highlight >= filteredUsers.length) setHighlight(0);
  }, [filteredUsers.length, highlight]);

  /** Перечитываем позицию каретки и обновляем состояние @-поиска. */
  function updateMentionState(text: string, caret: number) {
    // Ищем последний `@` слева от каретки, перед которым пробел/начало строки
    // и после которого нет пробелов до каретки.
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === '@') {
        const prev = i === 0 ? ' ' : text[i - 1];
        if (/\s|[(]/.test(prev) || i === 0) {
          const query = text.slice(i + 1, caret);
          if (/^[\wа-яА-ЯёЁ -]*$/.test(query) && query.length <= 30) {
            setMentionQuery(query);
            setMentionStart(i);
            return;
          }
        }
        break;
      }
      if (/\s/.test(ch)) break;
      i -= 1;
    }
    setMentionQuery(null);
    setMentionStart(-1);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    // Атрибут maxLength на textarea отрежет обычный набор, но защищаемся ещё и здесь —
    // на случай вставки из буфера, drag-and-drop и сценариев, где браузер пропустит.
    const next = e.target.value.slice(0, COMMENT_MAX_LENGTH);
    setValue(next);
    const caret = Math.min(e.target.selectionStart ?? next.length, next.length);
    updateMentionState(next, caret);
  }

  function selectMention(user: User) {
    if (mentionStart < 0) return;
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(caret);
    // Вставляем «@Имя » — пробел в конце, чтобы каретка не липла к следующей букве.
    const inserted = `@${user.fullName} `;
    // Если суммарно вылезаем за лимит — обрезаем хвост (текст после каретки).
    const combined = `${before}${inserted}${after}`;
    const next = combined.length > COMMENT_MAX_LENGTH ? combined.slice(0, COMMENT_MAX_LENGTH) : combined;
    setValue(next);
    if (!mentions.includes(user.id)) setMentions([...mentions, user.id]);
    setMentionQuery(null);
    setMentionStart(-1);
    // Возвращаем фокус и ставим каретку после вставленного фрагмента
    // (но не дальше реальной длины — на случай обрезки).
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = Math.min(before.length + inserted.length, next.length);
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filteredUsers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filteredUsers.length) % filteredUsers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(filteredUsers[highlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        setMentionStart(-1);
        return;
      }
    }
    // Cmd/Ctrl+Enter — отправка
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const text = value.trim();
    if (!text) return;
    // Оставляем в mentions только тех, кого реально упоминают в тексте.
    const used = mentions.filter((id) => {
      const u = users.find((x) => x.id === id);
      return u ? text.includes(`@${u.fullName}`) : false;
    });
    onSubmit(text, used);
    setValue('');
    setMentions([]);
    setMentionQuery(null);
    setMentionStart(-1);
  }

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Закрываем поповер с задержкой, чтобы клик по элементу успел сработать.
          setTimeout(() => {
            setMentionQuery(null);
            setMentionStart(-1);
          }, 120);
        }}
        placeholder={placeholder}
        disabled={isPending}
        maxLength={COMMENT_MAX_LENGTH}
        className="min-h-[72px] resize-y text-sm"
      />

      {filteredUsers.length > 0 && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {filteredUsers.map((u, i) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                // mousedown, чтобы перехватить событие до blur у текстареи.
                e.preventDefault();
                selectMention(u);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                i === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              <UserAvatar user={u} size={20} interactive={false} />
              <span className="truncate">{u.fullName}</span>
              <span className="ml-auto truncate text-[11px] text-muted-foreground">{u.email}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">
            <code className="rounded bg-muted px-1">@</code> упоминание · Cmd/Ctrl + Enter
          </span>
          <span
            className={cn(
              'tnum shrink-0 tabular-nums',
              value.length >= COMMENT_MAX_LENGTH
                ? 'font-medium text-red-600'
                : value.length >= COMMENT_WARN_THRESHOLD
                  ? 'text-amber-600'
                  : 'text-muted-foreground',
            )}
            aria-live="polite"
          >
            {value.length}/{COMMENT_MAX_LENGTH}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
              <X className="mr-1 h-3.5 w-3.5" />
              Отмена
            </Button>
          )}
          <Button type="button" size="sm" onClick={submit} disabled={isPending || !value.trim()}>
            <Send className="mr-1 h-3.5 w-3.5" />
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
