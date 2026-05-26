import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ContactForm } from '@/features/clients/ContactForm';
import { useClients, clientKeys } from '@/features/clients/hooks';
import { contactKeys } from './hooks';
import { clientsApi } from '@/api/clients';
import type { CreateContactRequest, UUID } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Глобальный диалог «Добавить контакт» — со страницы /contacts.
 * Отличается от AddContactDialog (внутри карточки клиента) тем,
 * что клиента нужно выбрать в форме (он не задан внешне).
 */
export function AddContactDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  // Берём максимум клиентов за один запрос (бэкенд ограничивает pageSize до 200).
  // При росте базы стоит перейти на асинхронный поиск по клиентам.
  const { data: clientsData } = useClients({ pageSize: 200 });

  const createContact = useMutation({
    mutationFn: ({ clientId, payload }: { clientId: UUID; payload: CreateContactRequest }) =>
      clientsApi.createContact(clientId, payload),
    onSuccess: (_contact, { clientId }) => {
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
      queryClient.invalidateQueries({ queryKey: clientKeys.contacts(clientId) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новое контактное лицо</DialogTitle>
          <DialogDescription>
            Выберите клиента и укажите ФИО и должность. Остальные поля — по желанию.
          </DialogDescription>
        </DialogHeader>
        <ContactForm
          key={open ? 'open' : 'closed'}
          clients={clientsData?.items ?? []}
          isPending={createContact.isPending}
          onSubmit={(values, clientId) => {
            if (!clientId) return;
            createContact.mutate(
              { clientId, payload: values },
              {
                onSuccess: (contact) => {
                  toast.success(`${contact.name} добавлен`);
                  onOpenChange(false);
                },
                onError: () => toast.error('Не удалось добавить контакт'),
              },
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
