import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Building2, ChevronLeft, Copy, Edit3, Mail, MoreHorizontal, Phone, X } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type { ContactListItem, CreateContactRequest } from '@/api/types';
import { ContactForm, type ContactFormValues } from '@/features/clients/ContactForm';
import { useCreateContact } from '@/features/clients/hooks';
import { useContact, useUpdateContact } from './hooks';

function toFormValues(contact: ContactListItem): Partial<ContactFormValues> {
  return {
    name: contact.name,
    role: contact.role,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
  };
}

export function ContactCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/contacts/$id' });
  const [editOpen, setEditOpen] = useState(false);
  const { data: contact, isLoading } = useContact(id);
  const updateContact = useUpdateContact();
  const createContact = useCreateContact(contact?.clientId ?? '');
  const close = () => navigate({ to: '/contacts' });

  const handleCopy = () => {
    if (!contact) return;
    createContact.mutate(
      {
        name: `${contact.name} (копия)`,
        role: contact.role,
        ...(contact.email ? { email: contact.email } : {}),
        ...(contact.phone ? { phone: contact.phone } : {}),
      },
      {
        onSuccess: (c) => {
          toast.success(`Создана копия «${c.name}»`);
          navigate({ to: '/contacts/$id', params: { id: c.id } });
        },
        onError: () => toast.error('Не удалось скопировать контакт'),
      },
    );
  };

  const initials = contact?.name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');

  const handleEdit = (payload: CreateContactRequest) => {
    if (!contact) return;
    updateContact.mutate(
      { id: contact.id, payload },
      {
        onSuccess: (c) => {
          toast.success(`Контакт «${c.name}» обновлён`);
          setEditOpen(false);
        },
        onError: () => toast.error('Не удалось сохранить изменения'),
      },
    );
  };

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && close()}>
        <SheetContent hideClose className="overflow-y-auto p-0 sm:max-w-lg">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={close}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!contact}
                onClick={() => setEditOpen(true)}
                aria-label="Редактировать контакт"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!contact || createContact.isPending}
                onClick={handleCopy}
                aria-label="Скопировать контакт"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Дополнительные действия">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button variant="ghost" size="icon" onClick={close}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {isLoading || !contact ? (
            <div className="space-y-3 px-6 py-6">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-24" />
            </div>
          ) : (
            <div className="space-y-6 px-6 py-6">
              <div className="space-y-3 pb-4">
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  Контактное лицо
                </div>
                <div className="flex items-center gap-3.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                    {initials}
                  </div>
                  <div>
                    <div className="text-[22px] font-bold leading-tight tracking-tight">{contact.name}</div>
                    <div className="text-sm text-muted-foreground">{contact.role}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {contact.email && (
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                      <a href={`mailto:${contact.email}`}>
                        <Mail className="h-3.5 w-3.5" />
                        Написать
                      </a>
                    </Button>
                  )}
                  {contact.phone && (
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                      <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>
                        <Phone className="h-3.5 w-3.5" />
                        Позвонить
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              <Separator />

              <div className="grid gap-y-3.5 text-sm">
                <Field
                  label="Email"
                  value={
                    contact.email ? (
                      <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
                        {contact.email}
                      </a>
                    ) : undefined
                  }
                />
                <Field label="Телефон" value={contact.phone} />
                <Field
                  label="Клиент"
                  value={
                    <button
                      type="button"
                      onClick={() => navigate({ to: '/clients/$id', params: { id: contact.clientId } })}
                      className="inline-flex items-center gap-1.5 text-left font-medium text-primary hover:underline"
                    >
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      {contact.clientName}
                    </button>
                  }
                />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader className="mb-4">
            <SheetTitle>Редактирование контакта</SheetTitle>
            <SheetDescription>Изменения сохраняются в карточке и в списке контактов.</SheetDescription>
          </SheetHeader>
          {contact && (
            <ContactForm
              key={contact.id}
              defaultValues={toFormValues(contact)}
              onSubmit={handleEdit}
              isPending={updateContact.isPending}
              submitLabel="Сохранить"
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div>{value ?? '—'}</div>
    </div>
  );
}
