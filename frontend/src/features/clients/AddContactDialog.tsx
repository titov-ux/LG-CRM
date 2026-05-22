import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ContactForm } from './ContactForm';
import { useCreateContact } from './hooks';
import type { UUID } from '@/api/types';

interface Props {
  clientId: UUID;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddContactDialog({ clientId, open, onOpenChange }: Props) {
  const createContact = useCreateContact(clientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новое контактное лицо</DialogTitle>
          <DialogDescription>
            Укажите ФИО и должность. Остальные поля — по желанию.
          </DialogDescription>
        </DialogHeader>
        <ContactForm
          key={open ? 'open' : 'closed'}
          isPending={createContact.isPending}
          onSubmit={(values) =>
            createContact.mutate(values, {
              onSuccess: (contact) => {
                toast.success(`${contact.name} добавлен`);
                onOpenChange(false);
              },
              onError: () => toast.error('Не удалось добавить контакт'),
            })
          }
        />
      </DialogContent>
    </Dialog>
  );
}
