import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Building2, ChevronLeft, Copy, Edit3, Mail, MoreHorizontal, Phone, Send, Share2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ContactListItem, CreateContactRequest } from '@/api/types';
import { ContactForm, type ContactFormValues } from '@/features/clients/ContactForm';
import { useCreateContact } from '@/features/clients/hooks';
import { formatDateRu, telegramUrl } from '@/lib/utils';
import { useContact, useDeleteContact, useUpdateContact } from './hooks';
import { CommentsSection } from '@/features/comments/CommentsSection';

function toFormValues(contact: ContactListItem): Partial<ContactFormValues> {
  return {
    name: contact.name,
    role: contact.role,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    telegram: contact.telegram ?? '',
    birthday: contact.birthday ?? '',
  };
}

export function ContactCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/contacts/$id' });
  const [editOpen, setEditOpen] = useState(false);
  const { data: contact, isLoading } = useContact(id);
  const updateContact = useUpdateContact();
  const createContact = useCreateContact(contact?.clientId ?? '');
  const deleteContact = useDeleteContact();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const close = () => navigate({ to: '/contacts' });

  const handleShare = async () => {
    if (!contact) return;
    const link = `${window.location.origin}/contacts/${contact.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Ссылка на контакт скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };

  const handleDelete = () => {
    if (!contact) return;
    deleteContact.mutate(
      { id: contact.id, clientId: contact.clientId },
      {
        onSuccess: () => {
          toast.success(`Контакт «${contact.name}» удалён`);
          setDeleteOpen(false);
          navigate({ to: '/contacts' });
        },
        onError: () => toast.error('Не удалось удалить контакт'),
      },
    );
  };

  const handleCopy = () => {
    if (!contact) return;
    createContact.mutate(
      {
        name: `${contact.name} (копия)`,
        role: contact.role,
        ...(contact.email ? { email: contact.email } : {}),
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(contact.telegram ? { telegram: contact.telegram } : {}),
        ...(contact.birthday ? { birthday: contact.birthday } : {}),
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={!contact} aria-label="Ещё">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={handleShare}>
                    <Share2 className="mr-2 h-3.5 w-3.5" />
                    Поделиться
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setDeleteOpen(true);
                    }}
                    className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-950/40"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Удалить
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                  {contact.telegram && (
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                      <a href={telegramUrl(contact.telegram)} target="_blank" rel="noopener noreferrer">
                        <Send className="h-3.5 w-3.5" />
                        Telegram
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
                  label="Telegram-аккаунт"
                  value={
                    contact.telegram ? (
                      <a
                        href={telegramUrl(contact.telegram)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {contact.telegram}
                      </a>
                    ) : undefined
                  }
                />
                <Field
                  label="День рождения"
                  value={contact.birthday ? formatDateRu(contact.birthday) : undefined}
                />
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

              <Separator />

              <CommentsSection entityType="contact" entityId={contact.id} />
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

      <Dialog open={deleteOpen} onOpenChange={(o) => !deleteContact.isPending && setDeleteOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить контакт?</DialogTitle>
            <DialogDescription>
              {contact && (
                <>
                  Контакт «<span className="font-medium text-foreground">{contact.name}</span>» будет удалён без возможности
                  восстановления.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteContact.isPending}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteContact.isPending}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {deleteContact.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
