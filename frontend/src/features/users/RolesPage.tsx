import { useMemo, useState } from 'react';
import { Check, Mail, Minus, Plus, RotateCcw, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { Role, User } from '@/api/types';
import { useDeleteUser, useResendInvite, useUpdateUser, useUsers } from './hooks';
import { AddUserDialog } from './AddUserDialog';
import { ROLE_DESCRIPTION, ROLE_LABEL } from './UserForm';
import { useAuthStore } from '@/stores/auth';
import type { MatrixPermission } from '@/lib/permissions';
import {
  usePermissionsMatrix,
  useResetPermissionsMatrix,
  useTogglePermission,
} from '@/features/permissions/hooks';

const ROLE_BADGE_CLASS: Record<Role, string> = {
  admin:
    'bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/40',
  account_manager:
    'bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/40',
  recruiter:
    'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/40',
  viewer:
    'bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800/60',
};

const ROLES_ORDER: Role[] = ['admin', 'account_manager', 'recruiter', 'viewer'];

export function RolesPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const currentUser = useAuthStore((s) => s.user);
  const { data: users, isLoading } = useUsers();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const resendInvite = useResendInvite();
  const canManageRoles = currentUser?.role === 'admin';

  const { permissions, isFetching: isPermissionsFetching } = usePermissionsMatrix();
  const togglePermissionMutation = useTogglePermission();
  const resetPermissionsMutation = useResetPermissionsMatrix();

  const filtered = useMemo(() => {
    const list = users ?? [];
    const s = search.trim().toLowerCase();
    return list.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!s) return true;
      return (
        u.fullName.toLowerCase().includes(s) ||
        u.email.toLowerCase().includes(s)
      );
    });
  }, [users, search, roleFilter]);

  const stats = useMemo(() => {
    const counts: Record<Role, number> = {
      admin: 0,
      account_manager: 0,
      recruiter: 0,
      viewer: 0,
    };
    (users ?? []).forEach((u) => {
      counts[u.role] = (counts[u.role] ?? 0) + 1;
    });
    const active = (users ?? []).filter((u) => u.isActive).length;
    return { counts, active, total: users?.length ?? 0 };
  }, [users]);

  const handleRoleChange = (user: User, role: Role) => {
    if (!canManageRoles) {
      toast.error('Менять роли может только администратор');
      return;
    }
    if (currentUser?.id === user.id) {
      toast.error('Нельзя изменить свою роль');
      return;
    }
    updateUser.mutate(
      { id: user.id, patch: { role } },
      {
        onSuccess: () => toast.success(`Роль ${user.fullName} обновлена`),
        onError: () => toast.error('Не удалось изменить роль'),
      },
    );
  };

  const handleActiveToggle = (user: User, isActive: boolean) => {
    updateUser.mutate(
      { id: user.id, patch: { isActive } },
      {
        onSuccess: () =>
          toast.success(
            isActive ? `${user.fullName} активирован` : `${user.fullName} деактивирован`,
          ),
        onError: () => toast.error('Не удалось обновить пользователя'),
      },
    );
  };

  const handleResendInvite = (user: User) => {
    resendInvite.mutate(user.id, {
      onSuccess: (res) => {
        if (res.emailSent) {
          toast.success(`Приглашение отправлено на ${res.user.email}`);
        } else if (res.inviteUrl) {
          navigator.clipboard.writeText(res.inviteUrl);
          toast.message('SMTP не настроен — ссылка скопирована в буфер', {
            description: res.inviteUrl,
          });
        }
      },
      onError: () => toast.error('Не удалось переотправить приглашение'),
    });
  };

  const handleDeleteConfirm = () => {
    if (!userToDelete) return;
    const user = userToDelete;
    if (currentUser?.id === user.id) {
      toast.error('Нельзя удалить свой аккаунт');
      setUserToDelete(null);
      return;
    }
    deleteUser.mutate(user.id, {
      onSuccess: () => {
        toast.success(`Пользователь «${user.fullName}» удалён`);
        setUserToDelete(null);
      },
      onError: () => toast.error('Не удалось удалить пользователя'),
    });
  };

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard label="Всего пользователей" value={stats.total} />
        <StatCard label="Активны" value={stats.active} accent="text-emerald-600" />
        <StatCard label="Администраторов" value={stats.counts.admin} accent="text-rose-600" />
        <StatCard label="Рекрутеров" value={stats.counts.recruiter} accent="text-emerald-700" />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'users' | 'roles')}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="users">Пользователи</TabsTrigger>
            <TabsTrigger value="roles">Роли и доступы</TabsTrigger>
          </TabsList>
          {tab === 'users' && (
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <UserPlus className="h-4 w-4" />
              Добавить пользователя
            </Button>
          )}
        </div>

        <TabsContent value="users" className="mt-0 space-y-3">
          <Card>
            <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по имени или email"
                  className="pl-8"
                />
              </div>
              <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as Role | 'all')}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все роли</SelectItem>
                  {ROLES_ORDER.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-[220px]">Роль</TableHead>
                  <TableHead className="w-[170px] text-center">Статус</TableHead>
                  <TableHead className="w-[110px] text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Никого не нашли. Попробуйте изменить фильтры или добавить нового пользователя.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <UserAvatar user={u} size={28} />
                        <div className="flex flex-col leading-tight">
                          <span className="text-[13px] font-semibold">{u.fullName}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {ROLE_LABEL[u.role]}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-[12.5px] text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      {(() => {
                        const canChangeThisRole = canManageRoles && currentUser?.id !== u.id;
                        return (
                      <Select
                        value={u.role}
                        onValueChange={(v) => handleRoleChange(u, v as Role)}
                        disabled={!canChangeThisRole}
                      >
                        <SelectTrigger
                          className="h-8 text-[12.5px]"
                          title={
                            canChangeThisRole
                              ? 'Изменить роль'
                              : canManageRoles
                                ? 'Нельзя изменить свою роль'
                                : 'Менять роли может только администратор'
                          }
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES_ORDER.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-center">
                      {u.isActive ? (
                        <div className="flex items-center justify-center gap-2">
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                            Активен
                          </Badge>
                          <Switch
                            checked
                            onCheckedChange={(v) => handleActiveToggle(u, v)}
                            disabled={currentUser?.id === u.id}
                          />
                        </div>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/40">
                          Не активирован
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {!u.isActive && canManageRoles && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleResendInvite(u)}
                            disabled={
                              resendInvite.isPending && resendInvite.variables === u.id
                            }
                            title="Переотправить приглашение на email"
                          >
                            <Mail className="h-4 w-4" />
                          </Button>
                        )}
                        {currentUser?.id !== u.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                            onClick={() => setUserToDelete(u)}
                            title="Удалить пользователя"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-0 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {ROLES_ORDER.map((r) => (
              <Card key={r}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{ROLE_LABEL[r]}</CardTitle>
                    <Badge variant="secondary" className={ROLE_BADGE_CLASS[r]}>
                      {stats.counts[r]}
                    </Badge>
                  </div>
                  <CardDescription className="text-[12px] leading-snug">
                    {ROLE_DESCRIPTION[r]}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {countAllowed(permissions, r)} из {permissions.length} прав
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div className="space-y-1.5">
                <CardTitle>
                  Матрица доступов
                  {isPermissionsFetching && (
                    <span className="ml-2 text-[11px] font-normal uppercase tracking-wider text-muted-foreground">
                      синхронизация…
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  Кликните по ячейке, чтобы переключить право для роли. Изменения
                  сохраняются на сервере и сразу применяются ко всем сотрудникам.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled={resetPermissionsMutation.isPending}
                onClick={() => {
                  resetPermissionsMutation.mutate(undefined, {
                    onSuccess: () => toast.success('Матрица доступов сброшена к умолчаниям'),
                    onError: () => toast.error('Не удалось сбросить матрицу'),
                  });
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {resetPermissionsMutation.isPending ? 'Сброс…' : 'Сбросить'}
              </Button>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-[260px]">Раздел / действие</TableHead>
                  {ROLES_ORDER.map((r) => (
                    <TableHead key={r} className="text-center">
                      {ROLE_LABEL[r]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.map((p, i) => {
                  const prev = permissions[i - 1];
                  const showGroup = !prev || prev.group !== p.group;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        {showGroup && (
                          <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                            {p.group}
                          </div>
                        )}
                        <div className="text-[13px] font-medium">{p.permission}</div>
                        <div className="text-[11.5px] text-muted-foreground">{p.description}</div>
                      </TableCell>
                      {ROLES_ORDER.map((r) => {
                        const allowed = p.matrix[r];
                        const busy =
                          togglePermissionMutation.isPending &&
                          togglePermissionMutation.variables?.id === p.id &&
                          togglePermissionMutation.variables?.role === r;
                        return (
                          <TableCell key={r} className="p-0 text-center">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={allowed}
                              aria-busy={busy || undefined}
                              aria-label={`${p.permission} — ${ROLE_LABEL[r]}: ${allowed ? 'разрешено' : 'запрещено'}`}
                              disabled={resetPermissionsMutation.isPending}
                              onClick={() =>
                                togglePermissionMutation.mutate(
                                  { id: p.id, role: r, allowed: !allowed },
                                  {
                                    onError: () =>
                                      toast.error('Не удалось обновить право'),
                                  },
                                )
                              }
                              className={cn(
                                'group mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-colors',
                                'hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                                'disabled:cursor-not-allowed disabled:opacity-50',
                                busy && 'animate-pulse',
                              )}
                            >
                              {allowed ? (
                                <Check className="h-4 w-4 text-emerald-600 transition-transform group-hover:scale-110" />
                              ) : (
                                <Minus className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                              )}
                            </button>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <Card className="border-dashed">
            <CardContent className="flex items-start gap-3 p-4 text-[12.5px] text-muted-foreground">
              <Plus className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Кастомные роли с детальной настройкой прав будут добавлены на этапе 2 —
                сейчас доступны 4 преднастроенные роли.
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddUserDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <Dialog
        open={!!userToDelete}
        onOpenChange={(o) => !deleteUser.isPending && !o && setUserToDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить пользователя?</DialogTitle>
            <DialogDescription>
              {userToDelete && (
                <>
                  Пользователь «
                  <span className="font-medium text-foreground">{userToDelete.fullName}</span>» будет удалён
                  без возможности восстановления. Его доступы аннулируются.
                  <span className="mt-2 block text-[12px] text-muted-foreground">
                    Если на нём «висели» вакансии, кандидаты, клиенты или комментарии —
                    они не удаляются: ответственный в этих записях просто сбросится в пустое значение.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setUserToDelete(null)}
              disabled={deleteUser.isPending}
            >
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleteUser.isPending}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {deleteUser.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`tnum text-2xl font-semibold ${accent ?? ''}`}>{value}</span>
      </CardContent>
    </Card>
  );
}

function countAllowed(rows: MatrixPermission[], role: Role) {
  return rows.filter((p) => p.matrix[role]).length;
}
