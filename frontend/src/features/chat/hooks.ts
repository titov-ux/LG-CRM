import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { chatApi } from '@/api/chat';
import type {
  AddChatMembersRequest,
  ChatConversation,
  ChatMessage,
  ChatMessagesPage,
  CreateChatGroupRequest,
  CreateDmRequest,
  UUID,
} from '@/api/types';
import { QUERY_DEFAULTS } from '@/lib/constants';

export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  conversation: (id: UUID) =>
    [...chatKeys.all, 'conversation', id] as const,
  /** История основной ленты (parent IS NULL). */
  messages: (conversationId: UUID) =>
    [...chatKeys.all, 'messages', conversationId] as const,
  /** История треда (корень + все ответы). */
  thread: (conversationId: UUID, rootId: UUID) =>
    [...chatKeys.all, 'thread', conversationId, rootId] as const,
  /** Полнотекстовый поиск. */
  search: (q: string, conversationId?: UUID) =>
    [...chatKeys.all, 'search', q, conversationId ?? null] as const,
};

export function useConversations(includeArchived = false) {
  return useQuery({
    queryKey: [...chatKeys.conversations(), { includeArchived }] as const,
    queryFn: () => chatApi.listConversations(includeArchived),
    ...QUERY_DEFAULTS,
    staleTime: 30_000,
  });
}

/**
 * Бесконечная история сообщений с keyset-пагинацией вверх.
 * Первая страница — последние сообщения; каждый следующий `fetchNextPage`
 * подгружает страницу старее по `before=nextCursor`.
 */
export function useMessages(conversationId: UUID | null) {
  return useInfiniteQuery({
    queryKey: conversationId
      ? chatKeys.messages(conversationId)
      : [...chatKeys.all, 'messages', 'none'],
    enabled: !!conversationId,
    queryFn: ({ pageParam }) =>
      chatApi.listMessages(conversationId as UUID, {
        limit: 50,
        before: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ChatMessagesPage) => last.nextCursor ?? undefined,
    ...QUERY_DEFAULTS,
    staleTime: 10_000,
  });
}

export function useCreateDm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateDmRequest) => chatApi.createDm(payload),
    onSuccess: (conv: ChatConversation) => {
      // Свежий список — сразу с новым DM наверху.
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      // На случай, если открытие DM сразу — прогреем кэш карточки.
      queryClient.setQueryData(chatKeys.conversation(conv.id), conv);
    },
  });
}

interface PostMessageArgs {
  text: string;
  parentMessageId?: UUID | null;
  fileIds?: UUID[];
}

export function usePostMessage(conversationId: UUID | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: PostMessageArgs | string) => {
      if (!conversationId) throw new Error('no conversation');
      const payload: PostMessageArgs =
        typeof args === 'string' ? { text: args } : args;
      return chatApi.postMessage(conversationId, payload);
    },
    onSuccess: (msg: ChatMessage) => {
      // Инвалидируем историю — react-query сам refetch-нет первую страницу.
      if (msg.parentMessageId) {
        // Ответ в тред: обновляем тред + лента основная (replyCount++).
        queryClient.invalidateQueries({
          queryKey: chatKeys.thread(msg.conversationId, msg.parentMessageId),
        });
        queryClient.invalidateQueries({
          queryKey: chatKeys.messages(msg.conversationId),
        });
      } else {
        queryClient.invalidateQueries({
          queryKey: chatKeys.messages(msg.conversationId),
        });
        // Свежий lastMessageAt в списке диалогов.
        queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      }
    },
  });
}

/**
 * Бесконечная история треда: корневое сообщение + все его ответы.
 * Сервер отдаёт их в одном keyset-окне (limit=200 хватает на любой
 * разумный тред).
 */
export function useThreadMessages(
  conversationId: UUID | null,
  rootId: UUID | null,
) {
  return useInfiniteQuery({
    queryKey:
      conversationId && rootId
        ? chatKeys.thread(conversationId, rootId)
        : [...chatKeys.all, 'thread', 'none'],
    enabled: !!conversationId && !!rootId,
    queryFn: ({ pageParam }) =>
      chatApi.listMessages(conversationId as UUID, {
        limit: 200,
        threadRootId: rootId as UUID,
        before: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ChatMessagesPage) => last.nextCursor ?? undefined,
    ...QUERY_DEFAULTS,
    staleTime: 10_000,
  });
}

export function useUpdateMessage(conversationId: UUID | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, text }: { messageId: UUID; text: string }) => {
      if (!conversationId) throw new Error('no conversation');
      return chatApi.updateMessage(conversationId, messageId, { text });
    },
    onSuccess: (msg: ChatMessage) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(msg.conversationId),
      });
      // Если сообщение в треде или это корень открытого треда — инвалидируем
      // все thread-кэши в рамках conversation. Точечно матчить корень не
      // обязательно, react-query сам сделает повторный запрос только по
      // активному треду.
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, 'thread', msg.conversationId],
      });
    },
  });
}

export function useDeleteMessage(conversationId: UUID | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: UUID) => {
      if (!conversationId) throw new Error('no conversation');
      return chatApi.deleteMessage(conversationId, messageId);
    },
    onSuccess: () => {
      if (!conversationId) return;
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, 'thread', conversationId],
      });
    },
  });
}

export function useMarkRead(conversationId: UUID | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lastReadMessageId: UUID) => {
      if (!conversationId) throw new Error('no conversation');
      return chatApi.markRead(conversationId, { lastReadMessageId });
    },
    onSuccess: () => {
      // Локально обновим список диалогов, чтобы unread-индикатор пропал.
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}

// === groups & reactions (Этап 3) ===========================================

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateChatGroupRequest) =>
      chatApi.createGroup(payload),
    onSuccess: (conv: ChatConversation) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      queryClient.setQueryData(chatKeys.conversation(conv.id), conv);
    },
  });
}

export function useRenameGroup(conversationId: UUID | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => {
      if (!conversationId) throw new Error('no conversation');
      return chatApi.renameGroup(conversationId, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}

export function useAddMembers(conversationId: UUID | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddChatMembersRequest) => {
      if (!conversationId) throw new Error('no conversation');
      return chatApi.addMembers(conversationId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}

export function useRemoveMember(conversationId: UUID | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: UUID) => {
      if (!conversationId) throw new Error('no conversation');
      return chatApi.removeMember(conversationId, userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}

export function useLeaveGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: UUID) => chatApi.leaveGroup(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}

export function useToggleReaction(conversationId: UUID | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      emoji,
    }: {
      messageId: UUID;
      emoji: string;
    }) => {
      if (!conversationId) throw new Error('no conversation');
      return chatApi.toggleReaction(conversationId, messageId, { emoji });
    },
    onSuccess: (msg: ChatMessage) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(msg.conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, 'thread', msg.conversationId],
      });
    },
  });
}

/**
 * Полнотекстовый поиск с дебаунсом. Запрос пускается, только если в строке
 * >=2 символа (короткие запросы дают слишком широкие результаты).
 */
export function useSearchMessages(
  q: string,
  opts: { conversationId?: UUID } = {},
) {
  const trimmed = q.trim();
  const enabled = trimmed.length >= 2;
  return useQuery({
    queryKey: chatKeys.search(trimmed, opts.conversationId),
    queryFn: () =>
      chatApi.search(trimmed, {
        conversationId: opts.conversationId,
        limit: 30,
      }),
    enabled,
    // Маленький staleTime — пользователь меняет запрос быстро, но один и тот
    // же ввод за секунду не нужно перезапрашивать.
    staleTime: 5_000,
  });
}

// === mute & archive (Этап 6) ===============================================

export function useMuteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      until,
    }: {
      conversationId: UUID;
      until: string | null;
    }) => chatApi.mute(conversationId, { until }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}

export function useArchiveConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: UUID) => chatApi.archive(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}

export function useUnarchiveConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: UUID) => chatApi.unarchive(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}
