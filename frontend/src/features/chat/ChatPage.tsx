/**
 * Внутренний чат — двухпанельный layout в эстетике Notion.
 *
 * Этап 2 (read-state + edit/delete + mentions):
 *   ┌──────────────┬───────────────────────────────────────────────┐
 *   │ список       │  header диалога                                │
 *   │ диалогов     │  ───────────────────────────────────────       │
 *   │ + unread     │  лента сообщений (старые → новые)             │
 *   │ + поиск      │  ───────────────────────────────────────       │
 *   │              │  composer + @-mention combobox                │
 *   └──────────────┴───────────────────────────────────────────────┘
 *
 * Сообщения вынесены в MessageItem (hover-actions, inline edit, placeholder
 * удалённого). Composer — отдельный файл с автокомплитом упоминаний. unread
 * считается по myLastReadAt vs lastMessageAt; авто-mark-read при скролле к низу.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  MoreHorizontal,
  Plus,
  Search,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useChatSoundsEnabled } from './sound';
import { useChatRealtime } from './useChatRealtime';
import {
  useArchiveConversation,
  useConversations,
  useMarkRead,
  useMessages,
  useMuteConversation,
  usePostMessage,
  useSearchMessages,
  useUnarchiveConversation,
} from './hooks';
import { SearchResults } from './SearchResults';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore } from './store';
import { NewChatDialog } from './NewChatDialog';
import { MessageItem } from './MessageItem';
import { Composer } from './Composer';
import { MembersSheet } from './MembersSheet';
import { ThreadPanel } from './ThreadPanel';
import { useOnlineUsers } from './useOnlineUsers';
import { useUsers } from '@/features/users/hooks';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ChatConversation, ChatMessage, User, UUID } from '@/api/types';

export function ChatPage() {
  // Подключаем realtime-инвалидацию (хук идемпотентен).
  useChatRealtime();

  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const { data: conversations = [] } = useConversations(showArchived);
  const [soundsOn, setSoundsOn] = useChatSoundsEnabled();
  const onlineUserIds = useOnlineUsers();
  const { data: usersData = [] } = useUsers();
  const userMap = useMemo(() => {
    const m = new Map<UUID, User>();
    for (const u of usersData) m.set(u.id, u);
    return m;
  }, [usersData]);

  // Авто-выбор первого диалога — иначе центр пустой.
  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      setActive(conversations[0].id);
    }
  }, [activeId, conversations, setActive]);

  const currentUser = useAuthStore((s) => s.user);

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      const title = titleOf(c, currentUser?.id ?? null, userMap).toLowerCase();
      return title.includes(q);
    });
  }, [conversations, search, userMap, currentUser?.id]);

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-[calc(100vh-var(--app-header-h,56px))] min-h-0 flex-1 overflow-hidden bg-background">
      {/* Левая колонка — список диалогов. */}
      <aside className="flex w-72 shrink-0 flex-col border-r bg-muted/20">
        <div className="flex shrink-0 items-center gap-1 px-3 pb-2 pt-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setSoundsOn(!soundsOn)}
            title={
              soundsOn ? 'Выключить звуки' : 'Включить звуки уведомлений'
            }
          >
            {soundsOn ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 shrink-0',
              showArchived && 'bg-muted text-foreground',
            )}
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? 'Показать активные' : 'Показать архив'}
          >
            <Archive className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setNewOpen(true)}
            title="Новый диалог"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {filteredConversations.length === 0 ? (
            <EmptySidebar onCreate={() => setNewOpen(true)} hasSearch={!!search} />
          ) : (
            filteredConversations.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                meId={currentUser?.id ?? null}
                userMap={userMap}
                onlineUserIds={onlineUserIds}
                unread={isUnread(c)}
                onClick={() => setActive(c.id)}
              />
            ))
          )}
          <SearchHits
            query={search}
            conversations={conversations}
            meId={currentUser?.id ?? null}
            userMap={userMap}
            onPick={(hit) => {
              setActive(hit.conversationId);
              setSearch('');
            }}
          />
        </div>
      </aside>

      {/* Центральная колонка — лента и composer. */}
      <section className="flex min-w-0 flex-1 flex-col">
        {activeConversation ? (
          <ConversationView
            conversation={activeConversation}
            meId={currentUser?.id ?? null}
            userMap={userMap}
            onlineUserIds={onlineUserIds}
          />
        ) : (
          <EmptyCenter onCreate={() => setNewOpen(true)} />
        )}
      </section>

      <NewChatDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

// === unread helpers ========================================================

function isUnread(c: ChatConversation): boolean {
  if (!c.lastMessageAt) return false;
  if (!c.myLastReadAt) return true;
  return +new Date(c.lastMessageAt) > +new Date(c.myLastReadAt);
}

// === sidebar items =========================================================

function titleOf(
  c: ChatConversation,
  meId: UUID | null,
  userMap: Map<UUID, User>,
): string {
  if (c.kind === 'group') return c.title ?? 'Без названия';
  const peerId = c.memberIds.find((id) => id !== meId);
  if (!peerId) return 'Диалог';
  return userMap.get(peerId)?.fullName ?? 'Пользователь';
}

function initialsOf(
  c: ChatConversation,
  meId: UUID | null,
  userMap: Map<UUID, User>,
): string {
  if (c.kind === 'group') {
    return (c.title ?? '#').slice(0, 2).toUpperCase();
  }
  const peerId = c.memberIds.find((id) => id !== meId);
  return (peerId ? userMap.get(peerId)?.initials : null) ?? '··';
}

function peerUserIdOf(c: ChatConversation, meId: UUID | null): UUID | null {
  if (c.kind !== 'dm') return null;
  return c.memberIds.find((id) => id !== meId) ?? null;
}

function AvatarWithStatusDot({
  initials,
  online,
}: {
  initials: string;
  online: boolean;
}) {
  return (
    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-[10.5px] font-medium text-foreground/70">
      {initials}
      {online && (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background bg-emerald-500"
          aria-label="онлайн"
        />
      )}
    </span>
  );
}

function ConversationRow({
  conversation,
  active,
  meId,
  userMap,
  onlineUserIds,
  unread,
  onClick,
}: {
  conversation: ChatConversation;
  active: boolean;
  meId: UUID | null;
  userMap: Map<UUID, User>;
  onlineUserIds: Set<UUID>;
  unread: boolean;
  onClick: () => void;
}) {
  const title = titleOf(conversation, meId, userMap);
  const initials = initialsOf(conversation, meId, userMap);
  const peerUserId = peerUserIdOf(conversation, meId);
  const isOnline = !!peerUserId && onlineUserIds.has(peerUserId);
  const muted =
    !!conversation.myMutedUntil &&
    +new Date(conversation.myMutedUntil) > Date.now();
  const archived = !!conversation.myHiddenAt;
  const mute = useMuteConversation();
  const archive = useArchiveConversation();
  const unarchive = useUnarchiveConversation();

  const muteFor = (hours: number | null) => {
    const until =
      hours === null
        ? new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    mute.mutate({ conversationId: conversation.id, until });
  };

  return (
    <div
      className={cn(
        'group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        active ? 'bg-background shadow-sm' : 'hover:bg-background/60',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <AvatarWithStatusDot initials={initials} online={isOnline} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] text-foreground',
            unread && !muted ? 'font-semibold' : 'font-medium',
            archived && 'text-muted-foreground',
          )}
        >
          {title}
        </span>
        {muted && (
          <BellOff
            className="h-3 w-3 shrink-0 text-muted-foreground/70"
            aria-label="уведомления выключены"
          />
        )}
        {conversation.lastMessageAt && (
          <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
            {formatShortTime(conversation.lastMessageAt)}
          </span>
        )}
        {unread && !active && !muted && (
          <span
            className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground"
            aria-label="есть непрочитанные"
          />
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6 shrink-0 text-muted-foreground/70',
              'opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100',
            )}
            title="Действия"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 text-[12.5px]">
          {muted ? (
            <DropdownMenuItem
              onClick={() =>
                mute.mutate({ conversationId: conversation.id, until: null })
              }
            >
              <Bell className="mr-2 h-3.5 w-3.5" />
              Включить уведомления
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => muteFor(1)}>
                <BellOff className="mr-2 h-3.5 w-3.5" />
                Mute на 1 час
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => muteFor(24)}>
                <BellOff className="mr-2 h-3.5 w-3.5" />
                Mute на 1 день
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => muteFor(null)}>
                <BellOff className="mr-2 h-3.5 w-3.5" />
                Mute навсегда
              </DropdownMenuItem>
            </>
          )}
          {archived ? (
            <DropdownMenuItem
              onClick={() => unarchive.mutate(conversation.id)}
            >
              <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
              Вернуть из архива
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => archive.mutate(conversation.id)}>
              <Archive className="mr-2 h-3.5 w-3.5" />
              Архивировать
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function EmptySidebar({
  onCreate,
  hasSearch,
}: {
  onCreate: () => void;
  hasSearch: boolean;
}) {
  return (
    <div className="px-3 pt-6 text-center text-[12px] text-muted-foreground">
      {hasSearch ? (
        <p>Ничего не найдено.</p>
      ) : (
        <>
          <p className="mb-3">Пока нет диалогов.</p>
          <Button size="sm" variant="outline" onClick={onCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Начать чат
          </Button>
        </>
      )}
    </div>
  );
}

function EmptyCenter({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-muted-foreground">
      <p className="text-sm">Выберите диалог слева или начните новый.</p>
      <Button size="sm" variant="outline" onClick={onCreate}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Новый диалог
      </Button>
    </div>
  );
}

// === center view ===========================================================

function ConversationView({
  conversation,
  meId,
  userMap,
  onlineUserIds,
}: {
  conversation: ChatConversation;
  meId: UUID | null;
  userMap: Map<UUID, User>;
  onlineUserIds: Set<UUID>;
}) {
  const title = titleOf(conversation, meId, userMap);
  const initials = initialsOf(conversation, meId, userMap);
  const peerUserId = peerUserIdOf(conversation, meId);
  const isOnline = !!peerUserId && onlineUserIds.has(peerUserId);
  const subtitle =
    conversation.kind === 'group'
      ? `${conversation.memberIds.length} участников`
      : 'Личный диалог';
  const [membersOpen, setMembersOpen] = useState(false);

  const { data, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage } =
    useMessages(conversation.id);
  const postMessage = usePostMessage(conversation.id);
  const markRead = useMarkRead(conversation.id);

  // Кандидаты для @-mentions: все юзеры диалога кроме меня.
  const mentionCandidates = useMemo<User[]>(() => {
    return conversation.memberIds
      .filter((id) => id !== meId)
      .map((id) => userMap.get(id))
      .filter((u): u is User => !!u);
  }, [conversation.memberIds, meId, userMap]);

  // Склейка страниц: старейшие страницы — в конце массива pages.
  const messages = useMemo<ChatMessage[]>(() => {
    if (!data?.pages) return [];
    const ordered: ChatMessage[] = [];
    for (let i = data.pages.length - 1; i >= 0; i--) {
      ordered.push(...data.pages[i].items);
    }
    return ordered;
  }, [data]);

  // Авто-скролл и «прилипание» к низу.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const lastConvId = useRef<UUID | null>(null);
  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;

  useEffect(() => {
    if (lastConvId.current !== conversation.id) {
      lastConvId.current = conversation.id;
      stickToBottom.current = true;
    }
  }, [conversation.id]);

  useEffect(() => {
    if (!scrollRef.current) return;
    if (!stickToBottom.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lastMessageId, conversation.id]);

  // Auto-mark-read: когда лента «прилипла» к низу и у нас есть какое-то
  // последнее сообщение, отправляем mark_read (только если оно ещё не
  // отмечено как прочитанное). Debounced через простой ref-таймер, чтобы
  // не дёргать сервер на каждый рендер.
  const lastReadSent = useRef<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!lastMessageId) return;
    if (!stickToBottom.current) return;
    // Не повторяем то, что уже отправляли.
    if (lastReadSent.current === lastMessageId) return;
    // И не отправляем, если у нас в conversation уже зафиксировано это id.
    if (conversation.myLastReadMessageId === lastMessageId) {
      lastReadSent.current = lastMessageId;
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      lastReadSent.current = lastMessageId;
      markRead.mutate(lastMessageId);
    }, 400);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // markRead интентом не зависит, лишний раз пересоздавать не надо
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageId, conversation.id, conversation.myLastReadMessageId]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottom.current = distanceFromBottom < 80;
    // Бесконечная подгрузка вверх.
    if (el.scrollTop < 80 && hasNextPage && !isFetchingNextPage) {
      const prevHeight = el.scrollHeight;
      void fetchNextPage().then(() => {
        requestAnimationFrame(() => {
          if (!scrollRef.current) return;
          const diff = scrollRef.current.scrollHeight - prevHeight;
          scrollRef.current.scrollTop = scrollRef.current.scrollTop + diff;
        });
      });
    }
  };

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <AvatarWithStatusDot initials={initials} online={isOnline} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-tight">
            {title}
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
        {conversation.kind === 'group' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMembersOpen(true)}
            title="Участники группы"
          >
            <Users className="h-4 w-4" />
          </Button>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
      >
        {isFetching && messages.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-muted-foreground">
            Загружаем…
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-muted-foreground">
            Сообщений пока нет — напишите первое.
          </div>
        ) : (
          <MessageList
            messages={messages}
            meId={meId}
            userMap={userMap}
            onlineUserIds={onlineUserIds}
          />
        )}
      </div>

      <Composer
        disabled={postMessage.isPending}
        candidates={mentionCandidates}
        onSend={({ text, fileIds }) =>
          postMessage.mutate({ text, fileIds })
        }
      />

      {conversation.kind === 'group' && (
        <MembersSheet
          open={membersOpen}
          onOpenChange={setMembersOpen}
          conversation={conversation}
        />
      )}

      <ThreadPanelHost
        conversation={conversation}
        meId={meId}
        userMap={userMap}
      />
    </>
  );
}

function ThreadPanelHost({
  conversation,
  meId,
  userMap,
}: {
  conversation: ChatConversation;
  meId: UUID | null;
  userMap: Map<UUID, User>;
}) {
  const rootId = useChatStore((s) => s.activeThreadRootId);
  if (!rootId) return null;
  return (
    <ThreadPanel
      conversation={conversation}
      rootId={rootId}
      meId={meId}
      userMap={userMap}
    />
  );
}

// === messages ==============================================================

function MessageList({
  messages,
  meId,
  userMap,
  onlineUserIds,
}: {
  messages: ChatMessage[];
  meId: UUID | null;
  userMap: Map<UUID, User>;
  onlineUserIds: Set<UUID>;
}) {
  // Группируем подряд идущие сообщения от одного автора в один «блок».
  type Block = { authorId: UUID | null; items: ChatMessage[] };
  const blocks: Block[] = [];
  for (const m of messages) {
    const last = blocks[blocks.length - 1];
    if (
      last &&
      last.authorId === m.authorUserId &&
      withinFiveMinutes(last.items[last.items.length - 1].createdAt, m.createdAt)
    ) {
      last.items.push(m);
    } else {
      blocks.push({ authorId: m.authorUserId, items: [m] });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b, i) => (
        <MessageBlock
          key={`${b.authorId ?? 'gone'}-${b.items[0].id}-${i}`}
          block={b}
          meId={meId}
          userMap={userMap}
          onlineUserIds={onlineUserIds}
        />
      ))}
    </div>
  );
}

function MessageBlock({
  block,
  meId,
  userMap,
  onlineUserIds,
}: {
  block: { authorId: UUID | null; items: ChatMessage[] };
  meId: UUID | null;
  userMap: Map<UUID, User>;
  onlineUserIds: Set<UUID>;
}) {
  const author = block.authorId ? userMap.get(block.authorId) : null;
  const isMe = block.authorId !== null && block.authorId === meId;
  const name = author?.fullName ?? (block.authorId ? 'Пользователь' : 'Бывший сотрудник');
  const initials = author?.initials ?? '··';
  const isOnline = !!block.authorId && onlineUserIds.has(block.authorId);
  return (
    <div className="flex gap-3">
      <div className="shrink-0 pt-0.5">
        <AvatarWithStatusDot initials={initials} online={isOnline} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-foreground">
            {isMe ? 'Вы' : name}
          </span>
          <span className="text-[10.5px] text-muted-foreground/70">
            {formatShortTime(block.items[0].createdAt)}
          </span>
        </div>
        <div className="space-y-1">
          {block.items.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              isMine={isMe}
              meId={meId}
              userMap={userMap}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// === utils =================================================================

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function withinFiveMinutes(aIso: string, bIso: string): boolean {
  return Math.abs(+new Date(bIso) - +new Date(aIso)) < 5 * 60_000;
}

// === search ================================================================

function SearchHits({
  query,
  conversations,
  meId,
  userMap,
  onPick,
}: {
  query: string;
  conversations: ChatConversation[];
  meId: UUID | null;
  userMap: Map<UUID, User>;
  onPick: (hit: import('@/api/types').ChatSearchHit) => void;
}) {
  // Запрос пускается внутри хука только при >= 2 символов.
  const { data, isFetching } = useSearchMessages(query);
  if (query.trim().length < 2) return null;
  return (
    <SearchResults
      query={query.trim()}
      loading={isFetching && !data}
      hits={data?.items ?? []}
      conversations={conversations}
      meId={meId}
      userMap={userMap}
      onPick={onPick}
    />
  );
}
