/**
 * Список найденных сообщений (Этап 5). Появляется в левом сайдбаре под
 * заголовком «Сообщения», когда в поиске введено >= 2 символа.
 *
 * Snippet приходит с бэка в виде HTML с `<mark>...</mark>` (ts_headline) —
 * рендерим через dangerouslySetInnerHTML. Это безопасно, так как Postgres
 * ts_headline экранирует HTML на входе и вставляет только свои теги.
 *
 * Клик по результату — переключаемся на соответствующий диалог. Подсветить
 * конкретное сообщение в ленте — отдельная фича; на этом этапе мы просто
 * скроллимся в активный диалог.
 */
import { Search } from 'lucide-react';
import type { ChatConversation, ChatSearchHit, User, UUID } from '@/api/types';
import { cn } from '@/lib/utils';

interface Props {
  query: string;
  loading: boolean;
  hits: ChatSearchHit[];
  conversations: ChatConversation[];
  meId: UUID | null;
  userMap: Map<UUID, User>;
  onPick: (hit: ChatSearchHit) => void;
}

export function SearchResults({
  query,
  loading,
  hits,
  conversations,
  meId,
  userMap,
  onPick,
}: Props) {
  if (loading) {
    return (
      <div className="border-t px-3 py-3 text-[11.5px] text-muted-foreground">
        Ищем «{query}»…
      </div>
    );
  }
  if (hits.length === 0) {
    return (
      <div className="border-t px-3 py-3 text-[11.5px] text-muted-foreground">
        Сообщения по «{query}» не найдены.
      </div>
    );
  }
  return (
    <div className="border-t pb-2">
      <div className="px-3 pb-1 pt-2 text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
        Сообщения · {hits.length}
      </div>
      {hits.map((hit) => (
        <HitRow
          key={hit.message.id}
          hit={hit}
          conversations={conversations}
          meId={meId}
          userMap={userMap}
          onClick={() => onPick(hit)}
        />
      ))}
    </div>
  );
}

function HitRow({
  hit,
  conversations,
  meId,
  userMap,
  onClick,
}: {
  hit: ChatSearchHit;
  conversations: ChatConversation[];
  meId: UUID | null;
  userMap: Map<UUID, User>;
  onClick: () => void;
}) {
  const conv = conversations.find((c) => c.id === hit.conversationId);
  const author = hit.message.authorUserId
    ? userMap.get(hit.message.authorUserId)
    : null;
  const convTitle = conv ? convTitleOf(conv, meId, userMap) : 'Диалог';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/60',
      )}
    >
      <Search className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/70" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[11.5px] font-semibold text-foreground">
            {convTitle}
          </span>
          <span className="text-[10.5px] text-muted-foreground/70">
            · {author?.fullName ?? 'Бывший сотрудник'}
          </span>
        </span>
        <span
          className="mt-0.5 block break-words text-[11.5px] leading-snug text-foreground/80 [&_mark]:rounded-sm [&_mark]:bg-amber-100/80 [&_mark]:px-0.5 [&_mark]:text-amber-900"
          dangerouslySetInnerHTML={{ __html: hit.snippet }}
        />
      </span>
    </button>
  );
}

function convTitleOf(
  c: ChatConversation,
  meId: UUID | null,
  userMap: Map<UUID, User>,
): string {
  if (c.kind === 'group') return c.title ?? 'Без названия';
  const peerId = c.memberIds.find((id) => id !== meId);
  if (!peerId) return 'Диалог';
  return userMap.get(peerId)?.fullName ?? 'Пользователь';
}
