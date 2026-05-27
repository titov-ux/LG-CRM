/**
 * Парсинг и рендер текста сообщения с @-упоминаниями.
 *
 * Внутри проводки и БД упоминание хранится как токен `<@uuid>` (персональное)
 * или `<@all>` (broadcast на всех участников диалога, как @channel в Slack).
 * На фронте рендерится как «@Имя Фамилия» или «@all» (chip с фоном). Если
 * юзера не нашли в `userMap` (удалён) — показываем «@Бывший сотрудник» без
 * интерактива.
 *
 * Если я сам участник диалога, @all подсвечивается так же, как персональное
 * упоминание меня — янтарным.
 */
import type { User, UUID } from '@/api/types';
import { cn } from '@/lib/utils';

// Один общий регэксп — UUID или литерал «all». Так не получится двойного
// прохода и сохранится порядок токенов в выдаче.
const MENTION_RE =
  /<@(all|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

export function renderMessageText(
  text: string,
  userMap: Map<UUID, User>,
  opts: { highlightMeId?: UUID | null } = {},
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    const raw = match[1];
    if (raw === 'all') {
      // @all всегда «адресует меня», поэтому подсвечиваем как личное
      // упоминание — независимо от того, кто отправитель.
      nodes.push(
        <span
          key={`mall-${i++}-${start}`}
          className="mx-[1px] rounded px-[3px] py-[1px] text-[12.5px] font-medium bg-amber-100/70 text-amber-900"
          title="Упоминание всех участников диалога"
        >
          @all
        </span>,
      );
    } else {
      const uid = raw as UUID;
      const user = userMap.get(uid);
      const isMe = !!opts.highlightMeId && uid === opts.highlightMeId;
      nodes.push(
        <span
          key={`m-${i++}-${start}`}
          className={cn(
            'mx-[1px] rounded px-[3px] py-[1px] text-[12.5px] font-medium',
            isMe
              ? 'bg-amber-100/70 text-amber-900'
              : 'bg-muted text-foreground/80',
          )}
        >
          @{user?.fullName ?? 'Бывший сотрудник'}
        </span>,
      );
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
