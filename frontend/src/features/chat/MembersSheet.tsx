/**
 * Боковая шторка «Участники группы».
 *
 * — owner может переименовать (inline), добавить (через under-modal AddMembersDialog),
 *   удалить любого, выйти (autoreassign owner-а сервисом).
 * — обычный участник: видит состав + кнопка «Покинуть».
 *
 * Notion-эстетика: тонкие границы, моно-аватары, действия — иконки на ховере.
 */
import { useState } from 'react';
import { Check, LogOut, Pencil, Plus, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  useAddMembers,
  useLeaveGroup,
  useRemoveMember,
  useRenameGroup,
} from './hooks';
import { useChatStore } from './store';
import { useUsers } from '@/features/users/hooks';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import type { ChatConversation, User, UUID } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ChatConversation;
}

export function MembersSheet({ open, onOpenChange, conversation }: Props) {
  const { data: users = [] } = useUsers();
  const meId = useAuthStore((s) => s.user?.id) ?? null;
  const setActive = useChatStore((s) => s.setActiveConversation);

  const memberUsers = conversation.memberIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is User => !!u);

  const amOwner = meId === conversation.createdBy;
  const [renameMode, setRenameMode] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title ?? '');
  const [addOpen, setAddOpen] = useState(false);

  const rename = useRenameGroup(conversation.id);
  const remove = useRemoveMember(conversation.id);
  const leave = useLeaveGroup();

  const saveTitle = () => {
    const t = titleDraft.trim();
    if (!t || t === conversation.title) {
      setRenameMode(false);
      setTitleDraft(conversation.title ?? '');
      return;
    }
    rename.mutate(t, { onSuccess: () => setRenameMode(false) });
  };

  const handleLeave = () => {
    if (!confirm('Выйти из группы?')) return;
    leave.mutate(conversation.id, {
      onSuccess: () => {
        onOpenChange(false);
        setActive(null);
      },
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-sm flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-[14px]">Участники</SheetTitle>
        </SheetHeader>

        {/* Title row */}
        <div className="border-b px-5 py-3">
          {renameMode ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveTitle();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenameMode(false);
                    setTitleDraft(conversation.title ?? '');
                  }
                }}
                className="h-8 text-[13px]"
                maxLength={255}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  setRenameMode(false);
                  setTitleDraft(conversation.title ?? '');
                }}
                title="Отмена"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                className="h-7 w-7"
                onClick={saveTitle}
                disabled={rename.isPending || !titleDraft.trim()}
                title="Сохранить"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                {conversation.title ?? 'Без названия'}
              </div>
              {amOwner && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => {
                    setTitleDraft(conversation.title ?? '');
                    setRenameMode(true);
                  }}
                  title="Переименовать"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Members list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {amOwner && (
            <Button
              variant="ghost"
              className="mb-1 h-8 w-full justify-start gap-2 px-3 text-[12.5px]"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить участника
            </Button>
          )}
          {memberUsers.map((u) => {
            const isMe = u.id === meId;
            const isOwner = u.id === conversation.createdBy;
            return (
              <div
                key={u.id}
                className="group flex items-center gap-3 rounded-md px-3 py-1.5 hover:bg-muted/40"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-[10.5px] font-medium text-foreground/70">
                  {u.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {u.fullName} {isMe && (
                      <span className="text-muted-foreground">(вы)</span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {isOwner ? 'Владелец' : 'Участник'}
                  </span>
                </span>
                {amOwner && !isMe && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn(
                      'h-6 w-6 text-destructive hover:text-destructive',
                      'opacity-0 group-hover:opacity-100',
                    )}
                    title="Убрать из группы"
                    onClick={() => {
                      if (confirm(`Убрать ${u.fullName} из группы?`))
                        remove.mutate(u.id);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Leave */}
        <div className="border-t px-5 py-3">
          <Button
            variant="outline"
            className="w-full justify-center gap-2 text-destructive hover:text-destructive"
            onClick={handleLeave}
            disabled={leave.isPending}
          >
            <LogOut className="h-3.5 w-3.5" />
            Покинуть группу
          </Button>
        </div>

        {addOpen && (
          <AddMembersDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            conversation={conversation}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// === inner: add members ====================================================

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function AddMembersDialog({
  open,
  onOpenChange,
  conversation,
}: Props) {
  const { data: users = [] } = useUsers();
  const meId = useAuthStore((s) => s.user?.id);
  const [picked, setPicked] = useState<Set<UUID>>(new Set());
  const [q, setQ] = useState('');
  const add = useAddMembers(conversation.id);

  const candidates = users.filter(
    (u) =>
      u.id !== meId &&
      u.isActive !== false &&
      !conversation.memberIds.includes(u.id) &&
      (!q.trim() ||
        u.fullName.toLowerCase().includes(q.trim().toLowerCase()) ||
        u.email.toLowerCase().includes(q.trim().toLowerCase())),
  );

  const submit = () => {
    if (picked.size === 0 || add.isPending) return;
    add.mutate(
      { userIds: Array.from(picked) },
      {
        onSuccess: () => {
          setPicked(new Set());
          setQ('');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-5 pb-2 pt-5">
          <DialogTitle className="text-[14px]">Добавить участников</DialogTitle>
        </DialogHeader>
        <div className="shrink-0 px-5 pb-2 pt-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Найти сотрудника"
            className="h-9 text-[13px]"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {candidates.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              Нет подходящих кандидатов.
            </div>
          ) : (
            candidates.map((u) => {
              const checked = picked.has(u.id);
              return (
                <label
                  key={u.id}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 hover:bg-muted/60',
                    checked && 'bg-muted/60',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={checked}
                    onChange={() => {
                      setPicked((p) => {
                        const next = new Set(p);
                        if (next.has(u.id)) next.delete(u.id);
                        else next.add(u.id);
                        return next;
                      });
                    }}
                  />
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-[10.5px] font-medium text-foreground/70">
                    {u.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {u.fullName}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {u.email}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={picked.size === 0 || add.isPending}
          >
            Добавить ({picked.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
