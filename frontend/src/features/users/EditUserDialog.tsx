import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { User } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { UserForm } from './UserForm';
import { useUpdateUser } from './hooks';

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
  const currentUser = useAuthStore((s) => s.user);
  const isSelf = !!user && currentUser?.id === user.id;

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
      </DialogContent>
    </Dialog>
  );
}
