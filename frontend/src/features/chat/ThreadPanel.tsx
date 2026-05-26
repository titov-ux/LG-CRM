/**
 * Правая шторка треда. Открывается по клику на бейдж «N ответов» под
 * корневым сообщением в основной ленте.
 *
 * Структура:
 *   ┌─────────────────────────────────┐
 *   │ header: «Тред» + close           │
 *   │─────────────────────────────────│
 *   │ корневое сообщение               │
 *   │ ─── разделитель «N ответов» ─── │
 *   │ ответы (старые → новые)         │
 *   │─────────────────────────────────│
 *   │ composer ответа                 │
 *   └─────────────────────────────────┘
 *
 * По §6 плана треды одноуровневые: ответ на ответ всё равно ссылается на тот
 * же корень. Из шторки можно отправлять ответы (composer передаёт parent =
 * rootId), редактировать и удалять — те же MessageItem-компоненты.
 */
import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { MessageItem } from './MessageItem';
import { Composer } from './Composer';
import { usePostMessage, useThreadMessages } from './hooks';
import { useChatStore } from './store';
import type { ChatConversation, ChatMessage, User, UUID } from '@/api/types';

interface Props {
  conversation: ChatConversation;
  rootId: UUID;
  meId: UUID | null;
  userMap: Map<UUID, User>;
}

export function ThreadPanel({ conversation, rootId, meId, userMap }: Props) {
  const closeThread = useChatStore((s) => s.closeThread);
  const { data } = useThreadMessages(conversation.id, rootId);
  const postMessage = usePostMessage(conversation.id);

  const messages = useMemo<ChatMessage[]>(() => {
    if (!data?.pages) return [];
    const flat: ChatMessage[] = [];
    for (let i = data.pages.length - 1; i >= 0; i--) {
      flat.push(...data.pages[i].items);
    }
    // Сначала корень (parentId is null среди items), потом ответы по времени.
    // Сервер уже отдаёт в хронологическом порядке, и корень всегда раньше
    // ответов, но на всякий случай отдельно вытащим.
    return flat;
  }, [data]);

  const root = messages.find((m) => m.id === rootId) ?? null;
  const replies = messages.filter((m) => m.parentMessageId === rootId);

  const mentionCandidates = useMemo<User[]>(() => {
    return conversation.memberIds
      .filter((id) => id !== meId)
      .map((id) => userMap.get(id))
      .filter((u): u is User => !!u);
  }, [conversation.memberIds, meId, userMap]);

  return (
    <Sheet open onOpenChange={(open) => !open && closeThread()}>
      <SheetContent
        side="right"
        className="flex w-full max-w-md flex-col gap-0 p-0"
      >
        <header className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <div>
            <div className="text-[13.5px] font-semibold">Тред</div>
            <div className="text-[11px] text-muted-foreground">
              {replies.length}{' '}
              {pluralize(replies.length, 'ответ', 'ответа', 'ответов')}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => closeThread()}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {root ? (
            <>
              <MessageBlockOne
                message={root}
                meId={meId}
                userMap={userMap}
              />
              <div className="my-4 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                <span>
                  {replies.length}{' '}
                  {pluralize(
                    replies.length,
                    'ответ',
                    'ответа',
                    'ответов',
                  )}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              {replies.length === 0 ? (
                <div className="py-3 text-center text-[12px] text-muted-foreground">
                  Пока нет ответов — напишите первый.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {replies.map((m) => (
                    <MessageBlockOne
                      key={m.id}
                      message={m}
                      meId={meId}
                      userMap={userMap}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-[12px] text-muted-foreground">
              Загружаем тред…
            </div>
          )}
        </div>

        <Composer
          disabled={postMessage.isPending}
          candidates={mentionCandidates}
          onSend={({ text, fileIds }) =>
            postMessage.mutate({ text, fileIds, parentMessageId: rootId })
          }
        />
      </SheetContent>
    </Sheet>
  );
}

function MessageBlockOne({
  message,
  meId,
  userMap,
}: {
  message: ChatMessage;
  meId: UUID | null;
  userMap: Map<UUID, User>;
}) {
  const author = message.authorUserId
    ? userMap.get(message.authorUserId)
    : null;
  const isMe = !!meId && message.authorUserId === meId;
  const name =
    author?.fullName ??
    (message.authorUserId ? 'Пользователь' : 'Бывший сотрудник');
  const initials = author?.initials ?? '··';
  return (
    <div className="flex gap-3">
      <div className="shrink-0 pt-0.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-[10.5px] font-medium text-foreground/70">
          {initials}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-foreground">
            {isMe ? 'Вы' : name}
          </span>
          <span className="text-[10.5px] text-muted-foreground/70">
            {new Date(message.createdAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <MessageItem
          message={message}
          isMine={isMe}
          meId={meId}
          userMap={userMap}
          hideThreadBadge
        />
      </div>
    </div>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
