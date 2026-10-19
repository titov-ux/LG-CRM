/**
 * Список найденных сообщений (Этап 5). Появляется в левом сайдбаре под
 * заголовком «Сообщения», когда в поиске введено >= 2 символа.
 *
 * Snippet приходит с бэка как экранированный текст, где единственный тег —
 * `<mark>...</mark>` (ts_headline). HTML НЕ вставляем через innerHTML:
 * разбираем строку на куски «текст / подсветка» и рендерим их как текстовые
 * узлы — даже если бэк когда-нибудь вернёт сырой текст, скрипт не выполнится.
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
        <span className="mt-0.5 block break-words text-[11.5px] leading-snug text-foreground/80 [&_mark]:rounded-sm [&_mark]:bg-amber-100/80 [&_mark]:px-0.5 [&_mark]:text-amber-900">
          <Snippet html={hit.snippet} />
        </span>
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

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m] ?? m);
}

/** Безопасный рендер сниппета: только текст и <mark>, без innerHTML. */
function Snippet({ html }: { html: string }) {
  const parts = html.split(/(<mark>|<\/mark>)/);
  let highlighted = false;
  return (
    <>
      {parts.map((part, i) => {
        if (part === '<mark>') {
          highlighted = true;
          return null;
        }
        if (part === '</mark>') {
          highlighted = false;
          return null;
        }
        if (!part) return null;
        const text = decodeEntities(part);
        return highlighted ? <mark key={i}>{text}</mark> : <span key={i}>{text}</span>;
      })}
    </>
  );
}
