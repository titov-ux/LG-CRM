import { useMemo, useState } from 'react';
import { Check, Minus, Plus, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
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
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { Role, User } from '@/api/types';
import { useDeleteUser, useUpdateUser, useUsers } from './hooks';
import { AddUserDialog } from './AddUserDialog';
import { ROLE_DESCRIPTION, ROLE_LABEL } from './UserForm';

const ROLE_BADGE_CLASS: Record<Role, string> = {
  admin: 'bg-rose-100 text-rose-700 hover:bg-rose-100',
  account_manager: 'bg-violet-100 text-violet-700 hover:bg-violet-100',
  recruiter: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  viewer: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
};

interface PermissionRow {
  group: string;
  permission: string;
  description: string;
  matrix: Record<Role, boolean>;
}

const PERMISSIONS: PermissionRow[] = [
  {
    group: 'Клиенты',
    permission: 'Просмотр карточек клиентов',
    description: 'Доступ к списку и карточкам клиентов.',
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: true },
  },
  {
    group: 'Клиенты',
    permission: 'Создание и редактирование',
    description: 'Создавать, изменять данные клиентов и контакты.',
    matrix: { admin: true, account_manager: true, recruiter: false, viewer: false },
  },
  {
    group: 'Клиенты',
    permission: 'Удаление / архив',
    description: 'Перевод клиентов в архив или удаление.',
    matrix: { admin: true, account_manager: false, recruiter: false, viewer: false },
  },
  {
    group: 'Вакансии',
    permission: 'Просмотр всех вакансий',
    description: 'Видеть все вакансии компании, а не только свои.',
    matrix: { admin: true, account_manager: true, recruiter: false, viewer: true },
  },
  {
    group: 'Вакансии',
    permission: 'Создание / редактирование',
    description: 'Заводить новые вакансии и менять их статусы.',
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: false },
  },
  {
    group: 'Вакансии',
    permission: 'Назначение рекрутера',
    description: 'Распределять рекрутеров по вакансиям.',
    matrix: { admin: true, account_manager: true, recruiter: false, viewer: false },
  },
  {
    group: 'Кандидаты',
    permission: 'Просмотр базы кандидатов',
    description: 'Поиск и фильтрация кандидатов.',
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: true },
  },
  {
    group: 'Кандидаты',
    permission: 'Создание / редактирование',
    description: 'Добавлять и редактировать карточки кандидатов.',
    matrix: { admin: true, account_manager: false, recruiter: true, viewer: false },
  },
  {
    group: 'Кандидаты',
    permission: 'Презентация клиенту',
    description: 'Отправлять подборку кандидатов клиенту.',
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: false },
  },
  {
    group: 'Аналитика',
    permission: 'Доступ к аналитике',
    description: 'Доступ к разделу «Аналитика» и выгрузкам.',
    matrix: { admin: true, account_manager: true, recruiter: false, viewer: true },
  },
  {
    group: 'Администрирование',
    permission: 'Журнал действий',
    description: 'Просмотр аудит-логов изменений.',
    matrix: { admin: true, account_manager: false, recruiter: false, viewer: false },
  },
  {
    group: 'Администрирование',
    permission: 'Управление пользователями',
    description: 'Создание сотрудников, выдача ролей и доступов.',
    matrix: { admin: true, account_manager: false, recruiter: false, viewer: false },
  },
];

const ROLES_ORDER: Role[] = ['admin', 'account_manager', 'recruiter', 'viewer'];

export function RolesPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: users, isLoading } = useUsers();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

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

  const handleDelete = (user: User) => {
    if (!confirm(`Удалить пользователя ${user.fullName}?`)) return;
    deleteUser.mutate(user.id, {
      onSuccess: () => toast.success('Пользователь удалён'),
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
                  <TableHead className="w-[130px] text-center">Активен</TableHead>
                  <TableHead className="w-[80px] text-right">Действия</TableHead>
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
                      <Select
                        value={u.role}
                        onValueChange={(v) => handleRoleChange(u, v as Role)}
                      >
                        <SelectTrigger className="h-8 text-[12.5px]">
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
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={u.isActive}
                        onCheckedChange={(v) => handleActiveToggle(u, v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                        onClick={() => handleDelete(u)}
                        title="Удалить пользователя"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
                    {countAllowed(r)} из {PERMISSIONS.length} прав
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Матрица доступов</CardTitle>
              <CardDescription>
                Какие действия доступны каждой роли. Доступы фиксируются на уровне роли —
                чтобы выдать сотруднику больше прав, измените его роль.
              </CardDescription>
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
                {PERMISSIONS.map((p, i) => {
                  const prev = PERMISSIONS[i - 1];
                  const showGroup = !prev || prev.group !== p.group;
                  return (
                    <TableRow key={`${p.group}-${p.permission}`}>
                      <TableCell>
                        {showGroup && (
                          <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                            {p.group}
                          </div>
                        )}
                        <div className="text-[13px] font-medium">{p.permission}</div>
                        <div className="text-[11.5px] text-muted-foreground">{p.description}</div>
                      </TableCell>
                      {ROLES_ORDER.map((r) => (
                        <TableCell key={r} className="text-center">
                          {p.matrix[r] ? (
                            <Check className="mx-auto h-4 w-4 text-emerald-600" />
                          ) : (
                            <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" />
                          )}
                        </TableCell>
                      ))}
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

function countAllowed(role: Role) {
  return PERMISSIONS.filter((p) => p.matrix[role]).length;
}
