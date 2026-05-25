import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Mail } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { UserForm } from './UserForm';
import { useCreateUser } from './hooks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddUserDialog({ open, onOpenChange }: Props) {
  const createUser = useCreateUser();
  // Если SMTP не настроен — бэк вернёт inviteUrl, показываем экран «скопируйте ссылку».
  const [fallbackInvite, setFallbackInvite] = useState<{ name: string; url: string } | null>(null);

  const handleClose = (next: boolean) => {
    if (!next) setFallbackInvite(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {fallbackInvite ? 'Пользователь создан' : 'Новый пользователь'}
          </DialogTitle>
          <DialogDescription>
            {fallbackInvite
              ? 'Не удалось отправить письмо автоматически — скопируйте ссылку и перешлите её сотруднику любым удобным способом.'
              : 'Добавьте сотрудника и назначьте ему роль. Если оставить пароль пустым — на email уйдёт письмо с приглашением, и сотрудник сам задаст пароль.'}
          </DialogDescription>
        </DialogHeader>

        {fallbackInvite ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-[12px] text-muted-foreground">Ссылка для активации</div>
              <div className="mt-1 break-all font-mono text-[12.5px]">{fallbackInvite.url}</div>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(fallbackInvite.url);
                  toast.success('Ссылка скопирована');
                }}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Скопировать
              </Button>
              <Button onClick={() => handleClose(false)}>Готово</Button>
            </DialogFooter>
          </div>
        ) : (
          <UserForm
            isPending={createUser.isPending}
            onSubmit={(values) =>
              createUser.mutate(values, {
                onSuccess: (res) => {
                  if (res.inviteUrl) {
                    // Письмо не ушло — показываем экран с ссылкой и оставляем диалог открытым.
                    setFallbackInvite({ name: res.user.fullName, url: res.inviteUrl });
                    toast.message(`Пользователь ${res.user.fullName} создан`, {
                      icon: <Mail className="h-4 w-4" />,
                      description: 'Письмо не ушло — скопируйте ссылку вручную',
                    });
                  } else {
                    toast.success(
                      `Пользователь ${res.user.fullName} добавлен. Письмо с приглашением отправлено.`,
                    );
                    handleClose(false);
                  }
                },
                onError: (err: unknown) => {
                  const message =
                    err && typeof err === 'object' && 'message' in err
                      ? String((err as { message: unknown }).message)
                      : 'Не удалось создать пользователя';
                  toast.error(message);
                },
              })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
