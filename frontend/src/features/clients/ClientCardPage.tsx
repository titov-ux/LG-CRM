import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, Copy, Edit3, Mail, MoreHorizontal, Phone, Plus, Send, Share2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
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
import { UserAvatar } from '@/components/common/UserAvatar';
import { AddContactDialog } from './AddContactDialog';
import { ClientForm, type ClientFormValues } from './ClientForm';
import { ClientNotesSection } from './ClientNotesSection';
import { useClient, useClientContacts, useCreateClient, useDeleteClient, useUpdateClient, useUsers } from './hooks';
import { useVacancies } from '@/features/vacancies/hooks';
import { vacancyStatuses } from '@/mocks/db/vacancies';
import type { Client } from '@/api/types';
import { telegramUrl } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Лид', in_progress: 'В работе', active: 'Активный', paused: 'Приостановлен', archived: 'Архив',
};

function toFormValues(client: Client): Partial<ClientFormValues> {
  return {
    name: client.name,
    legalEntities: client.legalEntities.map((le) => ({ name: le.name, inn: le.inn })),
    industry: client.industry,
    accountManagerId: client.accountManagerId,
    status: client.status,
    telegramChat: client.telegramChat ?? '',
  };
}

function toDuplicatePayload(client: Client): Partial<Client> {
  return {
    name: `${client.name} (копия)`,
    legalEntities: client.legalEntities.map((le, i) => ({
      id: `le-${Date.now()}-${i}`,
      name: le.name,
      inn: le.inn,
    })),
    industry: client.industry,
    accountManagerId: client.accountManagerId,
    status: 'lead',
    ...(client.telegramChat ? { telegramChat: client.telegramChat } : {}),
  };
}

export function ClientCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/clients/$id' });
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { data: client, isLoading } = useClient(id);
  const { data: contacts } = useClientContacts(id);
  const { data: usersData } = useUsers();
  const { data: vacanciesData } = useVacancies({ clientId: id });
  const updateClient = useUpdateClient();
  const createClient = useCreateClient();
  const deleteClient = useDeleteClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const am = usersData?.find((u) => u.id === client?.accountManagerId);
  const contactsList = contacts ?? [];
  const close = () => navigate({ to: '/clients' });

  const handleShare = async () => {
    if (!client) return;
    const link = `${window.location.origin}/clients/${client.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Ссылка на клиента скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };

  const handleDelete = () => {
    if (!client) return;
    deleteClient.mutate(client.id, {
      onSuccess: () => {
        toast.success(`Клиент «${client.name}» удалён`);
        setDeleteOpen(false);
        navigate({ to: '/clients' });
      },
      onError: () => toast.error('Не удалось удалить клиента'),
    });
  };

  const handleCopy = () => {
    if (!client) return;
    createClient.mutate(toDuplicatePayload(client), {
      onSuccess: (c) => {
        toast.success(`Создана копия «${c.name}»`);
        navigate({ to: '/clients/$id', params: { id: c.id } });
      },
      onError: () => toast.error('Не удалось скопировать клиента'),
    });
  };

  const handleEdit = (values: ClientFormValues) => {
    if (!client) return;
    updateClient.mutate(
      {
        id: client.id,
        payload: {
          name: values.name,
          legalEntities: values.legalEntities.map((le, i) => ({
            id: client.legalEntities[i]?.id ?? `le-${Date.now()}-${i}`,
            name: le.name,
            inn: le.inn,
          })),
          industry: values.industry,
          accountManagerId: values.accountManagerId,
          status: values.status,
          ...(values.telegramChat.trim()
            ? { telegramChat: values.telegramChat.trim() }
            : { telegramChat: '' }),
        },
      },
      {
        onSuccess: (c) => {
          toast.success(`Клиент «${c.name}» обновлён`);
          setEditOpen(false);
        },
        onError: () => toast.error('Не удалось сохранить изменения'),
      },
    );
  };

  return (
    <>
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent hideClose className="overflow-y-auto p-0 sm:max-w-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={close}><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!client}
              onClick={() => setEditOpen(true)}
              aria-label="Редактировать клиента"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!client || createClient.isPending}
              onClick={handleCopy}
              aria-label="Скопировать клиента"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={!client} aria-label="Ещё">
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
          <Button variant="ghost" size="icon" onClick={close}><X className="h-3.5 w-3.5" /></Button>
        </div>

        {isLoading || !client ? (
          <div className="space-y-3 px-6 py-6"><Skeleton className="h-10 w-3/4" /><Skeleton className="h-32" /></div>
        ) : (
          <div className="min-w-0 space-y-6 overflow-x-hidden px-6 py-6">
            <div className="space-y-2 pb-4">
              <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Клиент · {client.industry}
              </div>
              <div className="text-[22px] font-bold leading-tight tracking-tight">{client.name}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {STATUS_LABEL[client.status]}
              </div>
            </div>

            <Separator />

            <Section title="Юридические лица">
              <div className="flex flex-col divide-y">
                {client.legalEntities.map((le) => (
                  <div key={le.id} className="py-2.5">
                    <div className="text-[13px] font-medium">{le.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground tnum">ИНН {le.inn}</div>
                  </div>
                ))}
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-x-7 gap-y-3.5 text-sm">
              <Field
                label="Аккаунт-менеджер"
                value={
                  am && (
                    <span className="flex items-center gap-1.5">
                      <UserAvatar user={am} size={20} />
                      <span>{am.fullName}</span>
                    </span>
                  )
                }
              />
              <Field label="Отрасль" value={client.industry} />
              <Field
                label="Telegram-чат"
                value={
                  client.telegramChat ? (
                    <a
                      href={telegramUrl(client.telegramChat)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Send className="h-3 w-3" />
                      {client.telegramChat}
                    </a>
                  ) : undefined
                }
              />
              <Field label="Открытых вакансий" value={<b className="tnum">{vacanciesData?.items.length ?? 0}</b>} />
              <Field label="Контактных лиц" value={contactsList.length} />
            </div>

            <Section
              title="Контактные лица"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setContactDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Добавить
                </Button>
              }
            >
              {contactsList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Контактов пока нет</p>
              ) : (
                <div className="flex flex-col divide-y">
                  {contactsList.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                          {p.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}
                        </div>
                        <div>
                          <div className="text-[13px] font-medium">{p.name}</div>
                          <div className="text-[11.5px] text-muted-foreground">{p.role}</div>
                          {(p.email || p.phone || p.telegram) && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {[p.email, p.phone, p.telegram].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {p.email && (
                          <Button variant="ghost" size="icon" asChild>
                            <a href={`mailto:${p.email}`} aria-label={`Написать ${p.name}`}>
                              <Mail className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        {p.phone && (
                          <Button variant="ghost" size="icon" asChild>
                            <a href={`tel:${p.phone.replace(/\s/g, '')}`} aria-label={`Позвонить ${p.name}`}>
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        {p.telegram && (
                          <Button variant="ghost" size="icon" asChild>
                            <a
                              href={telegramUrl(p.telegram)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Написать в Telegram ${p.name}`}
                            >
                              <Send className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <AddContactDialog
              clientId={id}
              open={contactDialogOpen}
              onOpenChange={setContactDialogOpen}
            />

            <Section title="Заметки">
              <ClientNotesSection clientId={id} users={usersData ?? []} />
            </Section>

            <Section title={`Вакансии · ${vacanciesData?.items.length ?? 0}`}>
              <div className="space-y-1.5">
                {(vacanciesData?.items ?? []).map((v) => {
                  const st = vacancyStatuses.find((s) => s.id === v.status);
                  return (
                    <button
                      type="button"
                      key={v.id}
                      onClick={() => navigate({ to: '/vacancies/$id', params: { id: v.id } })}
                      className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2.5 text-left hover:bg-muted"
                    >
                      <div>
                        <div className="text-[13px] font-semibold">{v.title}</div>
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {v.grade} · {v.format} · {v.candidatesCount} канд.
                        </div>
                      </div>
                      {st && (
                        <span className="inline-flex items-center gap-1.5 text-[11.5px]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
                          {st.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>

    <Sheet open={editOpen} onOpenChange={setEditOpen}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader className="mb-4">
          <SheetTitle>Редактирование клиента</SheetTitle>
          <SheetDescription>Изменения сохраняются в карточке и в списке клиентов.</SheetDescription>
        </SheetHeader>
        {client && (
          <ClientForm
            key={client.id}
            defaultValues={toFormValues(client)}
            onSubmit={handleEdit}
            isPending={updateClient.isPending}
          />
        )}
      </SheetContent>
    </Sheet>

    <Dialog open={deleteOpen} onOpenChange={(o) => !deleteClient.isPending && setDeleteOpen(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Удалить клиента?</DialogTitle>
          <DialogDescription>
            {client && (
              <>
                Клиент «<span className="font-medium text-foreground">{client.name}</span>» и все его контакты будут
                удалены без возможности восстановления. Вакансии клиента останутся в системе.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteClient.isPending}>
            Отмена
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteClient.isPending}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {deleteClient.isPending ? 'Удаление…' : 'Удалить'}
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

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}
