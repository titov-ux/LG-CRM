import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commentsApi } from '@/api/comments';
import { QUERY_DEFAULTS } from '@/lib/constants';
import type { CommentEntityType, CreateCommentRequest, UpdateCommentRequest, UUID } from '@/api/types';
import { notificationKeys } from '@/features/notifications/hooks';

export const commentKeys = {
  all: ['comments'] as const,
  list: (entityType: CommentEntityType, entityId: UUID) =>
    [...commentKeys.all, entityType, entityId] as const,
};

export function useComments(entityType: CommentEntityType, entityId: UUID | undefined) {
  return useQuery({
    queryKey: commentKeys.list(entityType, entityId ?? ''),
    queryFn: () => commentsApi.list(entityType, entityId as UUID),
    enabled: !!entityId,
    ...QUERY_DEFAULTS,
  });
}

export function useCreateComment(entityType: CommentEntityType, entityId: UUID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Omit<CreateCommentRequest, 'entityType' | 'entityId'>) =>
      commentsApi.create({ entityType, entityId, ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.list(entityType, entityId) });
      // Если в комментарии были @ упоминания — уведомления могли создаться.
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useUpdateComment(entityType: CommentEntityType, entityId: UUID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: UUID; payload: UpdateCommentRequest }) =>
      commentsApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.list(entityType, entityId) });
    },
  });
}

export function useDeleteComment(entityType: CommentEntityType, entityId: UUID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => commentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.list(entityType, entityId) });
    },
  });
}
