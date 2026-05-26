/**
 * Диалог «Новый чат» — Этап 3: личный (DM) или групповой.
 *
 * Notion-стилистика: вкладки в шапке без агрессивных бейджей, плоский список
 * с серыми инициалами вместо цветных аватаров. Лимит группы — 50 (см. §6
 * плана).
 */
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUsers } from '@/features/users/hooks';
import { useAuthStore } from '@/stores/auth';
import { useCreateDm, useCreateGroup } from './hooks';
import { useChatStore } from './store';
import { cn } from '@/lib/utils';
import type { User, UUID } from '@/api/types';

type Mode = 'dm' | 'group';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_LIMIT = 50;

export function NewChatDialog({ open, onOpenChange }: Props) {
  const [mode, setMode] = useState<Mode>('dm');
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Set<UUID>>(new Set());
  const { data: users = [] } = useUsers();
  const meId = useAuthStore((s) => s.user?.id);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const createDm = useCreateDm();
  const createGroup = useCreateGroup();

  const candidates = useMemo<User[]>(() => {
    const filtered = users.filter(
      (u) => u.id !== meId && u.isActive !== false,
    );
    if (!q.trim()) return filtered;
    const needle = q.trim().toLowerCase();
    return filtered.filter(
      (u) =>
        u.fullName.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle),
    );
  }, [users, q, meId]);

  const resetAndClose = () => {
    onOpenChange(false);
    // Стейт оставим как есть — модалка переоткроется с last state, что
    // обычно ожидаемо. Чистим только query.
    setQ('');
  };

  const pickDm = async (userId: UUID) => {
    const conv = await createDm.mutateAsync({ peerUserId: userId });
    setActive(conv.id);
    resetAndClose();
  };

  const togglePick = (userId: UUID) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < GROUP_LIMIT - 1) next.add(userId);
      return next;
    });
  };

  const submitGroup = async () => {
    const t = title.trim();
    if (!t || picked.size === 0 || createGroup.isPending) return;
    const conv = await createGroup.mutateAsync({
      title: t,
      memberIds: Array.from(picked),
    });
    setActive(conv.id);
    setTitle('');
    setPicked(new Set());
    resetAndClose();
  };

  const pickedUsers = useMemo<User[]>(() => {
    return users.filter((u) => picked.has(u.id));
  }, [users, picked]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-5 pb-2 pt-5">
          <DialogTitle className="text-[14.5px]">Новый чат</DialogTitle>
        </DialogHeader>

        {/* Tabs — Notion-стиль: подчёркивание активной вкладки. */}
        <div className="flex shrink-0 items-center gap-4 border-b px-5">
          <TabButton
            active={mode === 'dm'}
            onClick={() => setMode('dm')}
            label="Личный"
          />
          <TabButton
            active={mode === 'group'}
            onClick={() => setMode('group')}
            label="Групповой"
          />
        </div>

        {mode === 'group' && (
          <div className="shrink-0 border-b px-5 py-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Название группы"
              className="h-9 text-[13.5px]"
              maxLength={255}
            />
            {picked.size > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pickedUsers.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11.5px]"
                  >
                    {u.fullName}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => togglePick(u.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 text-[10.5px] text-muted-foreground">
              Выбрано {picked.size} из {GROUP_LIMIT - 1} возможных (вы автоматически становитесь владельцем).
            </div>
          </div>
        )}

        <div className="shrink-0 px-5 pb-2 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Найти сотрудника"
              className="h-9 pl-8 text-[13px]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {candidates.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              Никого не нашли.
            </div>
          ) : mode === 'dm' ? (
            candidates.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={createDm.isPending}
                onClick={() => void pickDm(u.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50',
                )}
              >
                <UserRow user={u} />
              </button>
            ))
          ) : (
            candidates.map((u) => {
              const checked = picked.has(u.id);
              return (
                <label
                  key={u.id}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-muted/60',
                    checked && 'bg-muted/60',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={checked}
                    onChange={() => togglePick(u.id)}
                  />
                  <UserRow user={u} />
                </label>
              );
            })
          )}
        </div>

        {mode === 'group' && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button variant="ghost" onClick={resetAndClose}>
              Отмена
            </Button>
            <Button
              onClick={() => void submitGroup()}
              disabled={
                !title.trim() ||
                picked.size === 0 ||
                createGroup.isPending
              }
            >
              Создать группу
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-1 py-2 text-[12.5px] font-medium transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function UserRow({ user }: { user: User }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-[10.5px] font-medium text-foreground/70">
        {user.initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {user.fullName}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {user.email}
        </span>
      </span>
    </span>
  );
}
