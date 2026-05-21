import { useMemo, useState } from 'react';
import { Edit3, MessageSquare, Reply, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useUsers } from '@/features/users/hooks';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import type { Comment, CommentEntityType, User } from '@/api/types';
import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from './hooks';
import { CommentComposer } from './CommentComposer';

interface Props {
  entityType: CommentEntityType;
  entityId: string;
}

/**
 * Универсальная секция комментариев: показываем «корневые» комментарии
 * с ветками ответов под ними. Используется в карточках контакта,
 * кандидата и вакансии — поведение одинаковое, отличается только entityType.
 */
export function CommentsSection({ entityType, entityId }: Props) {
  const { data: comments, isLoading } = useComments(entityType, entityId);
  const { data: users } = useUsers();
  const currentUser = useAuthStore((s) => s.user);
  const createComment = useCreateComment(entityType, entityId);

  const usersList = users ?? [];

  // Разбиваем комментарии на корневые и ответы.
  // Корневые сортируем по убыванию даты — новые сверху, как в большинстве лент.
  // Ответы внутри ветки сортируются ниже по возрастанию (логика диалога), это
  // не меняется.
  const { roots, replies } = useMemo(() => {
    const items = comments ?? [];
    const roots = items
      .filter((c) => !c.parentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const replies: Record<string, Comment[]> = {};
    for (const c of items) {
      if (c.parentId) {
        replies[c.parentId] = replies[c.parentId] ?? [];
        replies[c.parentId].push(c);
      }
    }
    return { roots, replies };
  }, [comments]);

  const total = comments?.length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="h-3 w-3" />
        Комментарии {total > 0 && <span className="text-foreground/80">· {total}</span>}
      </div>

      <CommentComposer
        users={usersList}
        placeholder="Добавить комментарий…"
        onSubmit={(text, mentions) => {
          createComment.mutate(
            { text, mentions },
            {
              onError: () => toast.error('Не удалось отправить комментарий'),
            },
          );
        }}
        isPending={createComment.isPending}
      />

      <div className="space-y-3 pt-1">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Загрузка…</div>
        ) : roots.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
            Пока нет комментариев. Будьте первым.
          </div>
        ) : (
          roots.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              replies={replies[c.id] ?? []}
              users={usersList}
              currentUserId={currentUser?.id}
              entityType={entityType}
              entityId={entityId}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ItemProps {
  comment: Comment;
  replies: Comment[];
  users: User[];
  currentUserId: string | undefined;
  entityType: CommentEntityType;
  entityId: string;
  isReply?: boolean;
}

function CommentItem({ comment, replies, users, currentUserId, entityType, entityId, isReply = false }: ItemProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const author = users.find((u) => u.id === comment.authorId);
  const isOwn = comment.authorId === currentUserId;

  const createComment = useCreateComment(entityType, entityId);
  const updateComment = useUpdateComment(entityType, entityId);
  const deleteComment = useDeleteComment(entityType, entityId);

  return (
    <div className={cn('rounded-md border bg-card/40 p-3', isReply && 'border-l-2 border-l-primary/40')}>
      <div className="flex items-start gap-2.5">
        {author ? (
          <UserAvatar user={author} size={28} />
        ) : (
          <div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
        )}
        <div className="flex-1 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[13px] font-semibold leading-tight">{author?.fullName ?? 'Неизвестный'}</div>
            <div className="text-[11px] text-muted-foreground">
              {new Date(comment.createdAt).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {comment.updatedAt && <span title={`изменено ${new Date(comment.updatedAt).toLocaleString('ru-RU')}`}> · ред.</span>}
            </div>
          </div>

          {editOpen ? (
            <CommentComposer
              users={users}
              initialValue={comment.text}
              initialMentions={comment.mentions}
              placeholder="Изменить комментарий…"
              submitLabel="Сохранить"
              autoFocus
              showCancel
              isPending={updateComment.isPending}
              onCancel={() => setEditOpen(false)}
              onSubmit={(text, mentions) => {
                updateComment.mutate(
                  { id: comment.id, payload: { text, mentions } },
                  {
                    onSuccess: () => setEditOpen(false),
                    onError: () => toast.error('Не удалось сохранить комментарий'),
                  },
                );
              }}
            />
          ) : (
            <CommentText text={comment.text} users={users} />
          )}

          {!editOpen && (
            <div className="flex items-center gap-1 pt-0.5">
              {!isReply && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11.5px] text-muted-foreground"
                  onClick={() => setReplyOpen((o) => !o)}
                >
                  <Reply className="h-3 w-3" />
                  Ответить
                </Button>
              )}
              {isOwn && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11.5px] text-muted-foreground"
                    onClick={() => setEditOpen(true)}
                  >
                    <Edit3 className="h-3 w-3" />
                    Изменить
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11.5px] text-muted-foreground hover:text-red-600"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Удалить
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {replyOpen && !isReply && (
        <div className="ml-9 mt-3 border-l-2 border-l-primary/30 pl-3">
          <CommentComposer
            users={users}
            placeholder={`Ответить ${author?.fullName ?? '…'}`}
            submitLabel="Ответить"
            autoFocus
            showCancel
            isPending={createComment.isPending}
            onCancel={() => setReplyOpen(false)}
            onSubmit={(text, mentions) => {
              createComment.mutate(
                { text, mentions, parentId: comment.id },
                {
                  onSuccess: () => setReplyOpen(false),
                  onError: () => toast.error('Не удалось отправить ответ'),
                },
              );
            }}
          />
        </div>
      )}

      {replies.length > 0 && (
        <div className="ml-9 mt-3 space-y-2.5">
          {replies
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map((r) => (
              <CommentItem
                key={r.id}
                comment={r}
                replies={[]}
                users={users}
                currentUserId={currentUserId}
                entityType={entityType}
                entityId={entityId}
                isReply
              />
            ))}
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={(o) => !deleteComment.isPending && setDeleteOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить комментарий?</DialogTitle>
            <DialogDescription>
              Комментарий будет удалён без возможности восстановления. Ответы под ним также удалятся.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteComment.isPending}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteComment.mutate(comment.id, {
                  onSuccess: () => setDeleteOpen(false),
                  onError: () => toast.error('Не удалось удалить комментарий'),
                })
              }
              disabled={deleteComment.isPending}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {deleteComment.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Рендерит текст комментария, подсвечивая `@Имя Фамилия` упомянутых
 * пользователей в виде «чипов».
 */
function CommentText({ text, users }: { text: string; users: User[] }) {
  const segments = useMemo(() => {
    if (users.length === 0) return [{ type: 'text' as const, value: text }];
    // Сортируем имена по убыванию длины — чтобы более длинные совпадения
    // ловились раньше («Анна Кузнецова» до «Анна»).
    const sorted = [...users].sort((a, b) => b.fullName.length - a.fullName.length);
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`@(${sorted.map((u) => escape(u.fullName)).join('|')})`, 'g');

    const out: Array<{ type: 'text' | 'mention'; value: string; user?: User }> = [];
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      const start = m.index ?? 0;
      if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
      const user = sorted.find((u) => u.fullName === m[1]);
      out.push({ type: 'mention', value: m[0], user });
      last = start + m[0].length;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
  }, [text, users]);

  return (
    <div className="whitespace-pre-wrap text-[13px] leading-5 text-foreground/90">
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <span
            key={i}
            className="mx-px rounded bg-primary/10 px-1 py-0.5 font-medium text-primary"
            title={seg.user?.email}
          >
            {seg.value}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </div>
  );
}
