import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserForm } from './UserForm';
import { useCreateUser } from './hooks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddUserDialog({ open, onOpenChange }: Props) {
  const createUser = useCreateUser();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый пользователь</DialogTitle>
          <DialogDescription>
            Добавьте сотрудника и назначьте ему роль. Доступы определяются выбранной ролью.
          </DialogDescription>
        </DialogHeader>
        <UserForm
          isPending={createUser.isPending}
          onSubmit={(values) =>
            createUser.mutate(values, {
              onSuccess: (u) => {
                toast.success(`Пользователь ${u.fullName} добавлен`);
                onOpenChange(false);
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
      </DialogContent>
    </Dialog>
  );
}
