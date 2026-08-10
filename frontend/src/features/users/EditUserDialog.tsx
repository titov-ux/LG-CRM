import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Dices, KeyRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { User } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { UserForm } from './UserForm';
import { useSetUserPassword, useUpdateUser } from './hooks';

/** Читаемый случайный пароль: буквы + цифры, без похожих символов (l/1/O/0). */
function generatePassword(length = 12): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const PASSWORD_VALID = (v: string) =>
  v.length >= 8 && v.length <= 64 && /[A-Za-zА-Яа-я]/.test(v) && /\d/.test(v);

interface Props {
  user: User | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Диалог редактирования пользователя админом: ФИО, email, telegram, роль, активность.
 * Бэкенд: PATCH /users/{id} (только admin, право users.manage).
 * Пароль здесь не меняется — для не активированных есть переотправка приглашения,
 * активные меняют пароль сами в профиле.
 */
export function EditUserDialog({ user, onOpenChange }: Props) {
  const updateUser = useUpdateUser();
  const setPassword = useSetUserPassword();
  const currentUser = useAuthStore((s) => s.user);
  const isSelf = !!user && currentUser?.id === user.id;
  const [newPassword, setNewPassword] = useState('');

  // Не тащим введённый пароль между разными пользователями.
  useEffect(() => {
    setNewPassword('');
  }, [user?.id]);

  const handleSetPassword = () => {
    if (!user) return;
    if (!PASSWORD_VALID(newPassword)) {
      toast.error('Пароль: минимум 8 символов, буквы и цифры');
      return;
    }
    setPassword.mutate(
      { id: user.id, password: newPassword },
      {
        onSuccess: () => {
          toast.success(
            `Пароль для «${user.fullName}» обновлён. Все его активные сессии завершены.`,
          );
          setNewPassword('');
        },
        onError: () => toast.error('Не удалось сменить пароль'),
      },
    );
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => !updateUser.isPending && !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {user && <UserAvatar user={user} size={28} />}
            Редактировать пользователя
          </DialogTitle>
          <DialogDescription>
            Изменения применяются сразу. Если поменять email — сотрудник будет входить
            в систему уже с новым адресом.
          </DialogDescription>
        </DialogHeader>

        {user && (
          <UserForm
            mode="edit"
            submitLabel="Сохранить"
            isPending={updateUser.isPending}
            disableRole={isSelf}
            disableActive={isSelf}
            defaultValues={{
              fullName: user.fullName,
              email: user.email,
              telegram: user.telegram ?? '',
              role: user.role,
              isActive: user.isActive,
            }}
            onSubmit={(values) =>
              updateUser.mutate(
                {
                  id: user.id,
                  patch: {
                    fullName: values.fullName,
                    email: values.email,
                    // Пустая строка = очистить telegram (на бэке null).
                    telegram: values.telegram?.trim() ? values.telegram.trim() : null,
                    // Свою роль/активность бэку не отправляем вовсе — поля заблокированы в форме.
                    ...(isSelf ? {} : { role: values.role, isActive: values.isActive }),
                  },
                },
                {
                  onSuccess: (updated) => {
                    toast.success(`Данные пользователя «${updated.fullName}» обновлены`);
                    onOpenChange(false);
                  },
                  onError: async (err: unknown) => {
                    // 409 email_exists — самый частый кейс, показываем внятный текст.
                    const resp = (err as { response?: Response }).response;
                    if (resp?.status === 409) {
                      toast.error('Этот email уже занят другим пользователем');
                    } else {
                      toast.error('Не удалось сохранить изменения');
                    }
                  },
                },
              )
            }
          />
        )}

        {user && !isSelf && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="admin-new-password" className="flex items-center gap-1.5 text-sm">
                <KeyRound className="h-3.5 w-3.5" />
                Сбросить пароль
              </Label>
              <p className="text-[12px] text-muted-foreground">
                Пользователь будет разлогинен на всех устройствах и сможет войти
                только с новым паролем. Передайте его сотруднику лично.
              </p>
              <div className="flex gap-2">
                <Input
                  id="admin-new-password"
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Минимум 8 символов, буквы и цифры"
                  autoComplete="off"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title="Сгенерировать пароль"
                  onClick={() => setNewPassword(generatePassword())}
                >
                  <Dices className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title="Скопировать пароль"
                  disabled={!newPassword}
                  onClick={() => {
                    navigator.clipboard.writeText(newPassword);
                    toast.success('Пароль скопирован');
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!newPassword || setPassword.isPending}
                  onClick={handleSetPassword}
                >
                  {setPassword.isPending ? 'Сохранение…' : 'Установить пароль'}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
