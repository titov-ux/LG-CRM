import { api } from './client';
import type { Comment, CommentEntityType, CreateCommentRequest, UpdateCommentRequest, UUID } from './types';

export const commentsApi = {
  list: (entityType: CommentEntityType, entityId: UUID) =>
    api
      .get('comments', { searchParams: { entityType, entityId } })
      .json<Comment[]>(),
  create: (payload: CreateCommentRequest) => api.post('comments', { json: payload }).json<Comment>(),
  update: (id: UUID, payload: UpdateCommentRequest) =>
    api.patch(`comments/${id}`, { json: payload }).json<Comment>(),
  remove: (id: UUID) => api.delete(`comments/${id}`).json<{ ok: true }>(),
};
