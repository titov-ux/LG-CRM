import { api } from './client';
import type {
  AddChatMembersRequest,
  ChatConversation,
  ChatMessage,
  ChatMessagesPage,
  ChatMuteRequest,
  ChatSearchResponse,
  CreateChatGroupRequest,
  CreateChatMessageRequest,
  CreateDmRequest,
  MarkChatReadRequest,
  RenameChatGroupRequest,
  ToggleChatReactionRequest,
  UpdateChatMessageRequest,
  UUID,
} from './types';

export const chatApi = {
  listConversations: (includeArchived = false) =>
    api
      .get('chat/conversations', {
        searchParams: includeArchived ? { includeArchived: 'true' } : {},
      })
      .json<ChatConversation[]>(),

  getConversation: (id: UUID) =>
    api.get(`chat/conversations/${id}`).json<ChatConversation>(),

  deleteConversation: (id: UUID) =>
    api.delete(`chat/conversations/${id}`).json<{ ok: true }>(),

  createDm: (payload: CreateDmRequest) =>
    api.post('chat/conversations/dm', { json: payload }).json<ChatConversation>(),

  listMessages: (
    conversationId: UUID,
    opts: { limit?: number; before?: string; threadRootId?: UUID } = {},
  ) => {
    const searchParams: Record<string, string | number> = {};
    if (opts.limit) searchParams.limit = opts.limit;
    if (opts.before) searchParams.before = opts.before;
    if (opts.threadRootId) searchParams.threadRootId = opts.threadRootId;
    return api
      .get(`chat/conversations/${conversationId}/messages`, { searchParams })
      .json<ChatMessagesPage>();
  },

  postMessage: (conversationId: UUID, payload: CreateChatMessageRequest) =>
    api
      .post(`chat/conversations/${conversationId}/messages`, { json: payload })
      .json<ChatMessage>(),

  updateMessage: (
    conversationId: UUID,
    messageId: UUID,
    payload: UpdateChatMessageRequest,
  ) =>
    api
      .patch(`chat/conversations/${conversationId}/messages/${messageId}`, {
        json: payload,
      })
      .json<ChatMessage>(),

  deleteMessage: (conversationId: UUID, messageId: UUID) =>
    api
      .delete(`chat/conversations/${conversationId}/messages/${messageId}`)
      .json<{ ok: true }>(),

  markRead: (conversationId: UUID, payload: MarkChatReadRequest) =>
    api
      .post(`chat/conversations/${conversationId}/read`, { json: payload })
      .json<{ ok: true }>(),

  // === groups ===
  createGroup: (payload: CreateChatGroupRequest) =>
    api
      .post('chat/conversations/group', { json: payload })
      .json<ChatConversation>(),

  renameGroup: (id: UUID, payload: RenameChatGroupRequest) =>
    api
      .patch(`chat/conversations/${id}`, { json: payload })
      .json<ChatConversation>(),

  addMembers: (id: UUID, payload: AddChatMembersRequest) =>
    api
      .post(`chat/conversations/${id}/members`, { json: payload })
      .json<ChatConversation>(),

  removeMember: (id: UUID, userId: UUID) =>
    api
      .delete(`chat/conversations/${id}/members/${userId}`)
      .json<{ ok: true }>(),

  leaveGroup: (id: UUID) =>
    api.post(`chat/conversations/${id}/leave`).json<{ ok: true }>(),

  // === reactions ===
  toggleReaction: (
    id: UUID,
    messageId: UUID,
    payload: ToggleChatReactionRequest,
  ) =>
    api
      .post(
        `chat/conversations/${id}/messages/${messageId}/reactions/toggle`,
        { json: payload },
      )
      .json<ChatMessage>(),

  // === mute & archive (Этап 6) ===
  mute: (id: UUID, payload: ChatMuteRequest) =>
    api.post(`chat/conversations/${id}/mute`, { json: payload }).json<ChatConversation>(),
  archive: (id: UUID) =>
    api.post(`chat/conversations/${id}/archive`).json<ChatConversation>(),
  unarchive: (id: UUID) =>
    api.post(`chat/conversations/${id}/unarchive`).json<ChatConversation>(),

  // === search (Этап 5) ===
  search: (
    q: string,
    opts: { conversationId?: UUID; limit?: number } = {},
  ) => {
    const searchParams: Record<string, string | number> = { q };
    if (opts.conversationId) searchParams.conversationId = opts.conversationId;
    if (opts.limit) searchParams.limit = opts.limit;
    return api.get('chat/search', { searchParams }).json<ChatSearchResponse>();
  },
};
