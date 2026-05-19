import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Save, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useAuthStore } from '@/stores/auth';
import { ROLE_LABEL } from '@/features/users/UserForm';

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-rose-100 text-rose-700 hover:bg-rose-100',
  account_manager: 'bg-violet-100 text-violet-700 hover:bg-violet-100',
  recruiter: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  viewer: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
};

export function ProfileHeaderCard() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');

  if (!user) return null;

  const startEdit = () => {
    setFullName(user.fullName);
    setEmail(user.email);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
  };

  const save = () => {
    if (fullName.trim().length < 2) {
      toast.error('Имя должно быть не короче 2 символов');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Введите корректный email');
      return;
    }
    // Локально: на этапе 2 — PATCH /users/{me}. См. ТЗ §6.2.
    const newInitials = fullName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
    setUser({ ...user, fullName: fullName.trim(), email: email.trim(), initials: newInitials });
    setEditing(false);
    toast.success('Профиль обновлён');
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <div className="flex shrink-0 items-center gap-4">
          <UserAvatar user={user} size={72} ring />
          <div className="sm:hidden">
            <div className="text-base font-semibold">{user.fullName}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[12px]">ФИО</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-lg font-semibold tracking-tight">{user.fullName}</span>
                <Badge
                  variant="secondary"
                  className={ROLE_BADGE[user.role] ?? 'bg-slate-100 text-slate-700'}
                >
                  {ROLE_LABEL[user.role]}
                </Badge>
                {!user.isActive && (
                  <Badge variant="secondary" className="bg-zinc-100 text-zinc-600">
                    Деактивирован
                  </Badge>
                )}
              </div>
              <div className="hidden text-[13px] text-muted-foreground sm:block">{user.email}</div>
              <div className="text-[11.5px] text-muted-foreground/80">ID: {user.id}</div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} className="gap-1.5">
                <X className="h-3.5 w-3.5" />
                Отмена
              </Button>
              <Button size="sm" onClick={save} className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                Сохранить
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Редактировать
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
