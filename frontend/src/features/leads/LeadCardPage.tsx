import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Building2,
  ChevronLeft,
  Copy,
  Edit3,
  Globe,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Send,
  Share2,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { KanbanStatusSelect } from '@/components/kanban/KanbanStatusSelect';
import { CommentsSection } from '@/features/comments/CommentsSection';
import { useUsers } from '@/features/users/hooks';
import { clientKeys } from '@/features/clients/hooks';
import { clientsApi } from '@/api/clients';
import { apiErrorMessage, formatDateRu, formatMoneyRub } from '@/lib/utils';
import type { Lead, LeadStatus } from '@/api/types';
import {
  useChangeLeadStatus,
  useCreateLead,
  useDeleteLead,
  useLead,
  useLeadActivity,
  useUpdateLead,
} from './hooks';
import { LeadForm, type LeadFormValues } from './LeadForm';
import { leadFormToPayload, leadToForm } from './utils';
import { LeadFinalStatusDialog } from './LeadFinalStatusDialog';
import { NextContactBadge } from './LeadKanbanCard';
import { isFinalLeadStatus, leadStatuses } from './statuses';

const ACTIVITY_ICON: Record<string, LucideIcon> = {
  status: ArrowRight,
  note: MessageCircle,
  call: Phone,
  email: Mail,
  create: Plus,
};
const ACTIVITY_PREVIEW_LIMIT = 5;

function toDuplicatePayload(l: Lead): Partial<Lead> {
  return {
    title: l.title,
    company: `${l.company} (копия)`,
    industry: l.industry,
    website: l.website,
    contactName: l.contactName,
    contactPosition: l.contactPosition,
    phone: l.phone,
    email: l.email,
    telegram: l.telegram,
    source: l.source,
    expectedValue: l.expectedValue,
    priority: l.priority,
    accountManagerId: l.accountManagerId,
    status: 'new',
  };
}

function websiteHref(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

function telegramHref(tg: string): string {
  if (/^https?:\/\//i.test(tg)) return tg;
  return `https://t.me/${tg.replace(/^@/, '')}`;
}

export function LeadCardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams({ from: '/_authed/leads/$id' });
  const { data: lead, isLoading } = useLead(id);
  const { data: activity, isLoading: activityLoading, isError: activityError } =
    useLeadActivity(id);
  const { data: usersData } = useUsers();

  const updateLead = useUpdateLead();
  const createLead = useCreateLead();
  const changeStatus = useChangeLeadStatus();
  const deleteLead = useDeleteLead();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [finalStatusTarget, setFinalStatusTarget] = useState<LeadStatus | null>(null);

  const close = () => navigate({ to: '/leads' });
  const accountManager = usersData?.find((u) => u.id === lead?.accountManagerId);
  const leadName = lead ? lead.company || lead.title : '';

  const activityItems = activity ?? [];
  const hiddenActivityCount = Math.max(activityItems.length - ACTIVITY_PREVIEW_LIMIT, 0);
  const visibleActivity = activityExpanded
    ? activityItems
    : activityItems.slice(0, ACTIVITY_PREVIEW_LIMIT);

  const commitStatusChange = (status: LeadStatus, comment?: string) => {
    if (!lead) return;
    changeStatus.mutate(
      { id: lead.id, status, comment },
      {
        onSuccess: (l) => {
          setFinalStatusTarget(null);
          toast.success(`Лид «${l.company || l.title}» — статус изменён`);
        },
        onError: async (e) => toast.error(await apiErrorMessage(e, 'Не удалось изменить статус')),
      },
    );
  };

  const handleStatusChange = (status: LeadStatus) => {
    if (!lead || status === lead.status) return;
    if (isFinalLeadStatus(status)) {
      setFinalStatusTarget(status);
      return;
    }
    commitStatusChange(status);
  };

  const handleShare = async () => {
    if (!lead) return;
    const link = `${window.location.origin}/leads/${lead.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Ссылка на лид скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };

  const handleDuplicate = () => {
    if (!lead) return;
    createLead.mutate(toDuplicatePayload(lead), {
      onSuccess: (l) => {
        toast.success(`Создана копия «${l.company}»`);
        navigate({ to: '/leads/$id', params: { id: l.id } });
      },
      onError: () => toast.error('Не удалось скопировать лид'),
    });
  };

  const handleDelete = () => {
    if (!lead) return;
    deleteLead.mutate(lead.id, {
      onSuccess: () => {
        toast.success(`Лид «${leadName}» удалён`);
        setDeleteOpen(false);
        navigate({ to: '/leads' });
      },
      onError: async (e) => toast.error(await apiErrorMessage(e, 'Не удалось удалить лид')),
    });
  };

  const handleEdit = (values: LeadFormValues) => {
    if (!lead) return;
    updateLead.mutate(
      { id: lead.id, payload: leadFormToPayload(values) },
      {
        onSuccess: (l) => {
          toast.success(`Лид «${l.company || l.title}» обновлён`);
          setEditOpen(false);
        },
        onError: async (e) =>
          toast.error(await apiErrorMessage(e, 'Не удалось сохранить изменения')),
      },
    );
  };

  /**
   * Конвертация лида в клиента CRM: создаём клиента (компания + отрасль +
   * ответственный), затем контакт из контактного лица, и привязываем клиента к
   * лиду, чтобы повторно не конвертировать.
   */
  const handleConvert = async () => {
    if (!lead) return;
    setConverting(true);
    try {
      const client = await clientsApi.create({
        name: lead.company || lead.title,
        industry: lead.industry ?? '',
        accountManagerId: lead.accountManagerId,
        status: 'in_progress',
        clientKind: 'direct',
        telegramChat: lead.telegram ?? undefined,
      });
      if (lead.contactName) {
        await clientsApi.createContact(client.id, {
          name: lead.contactName,
          role: lead.contactPosition ?? '',
          email: lead.email ?? undefined,
          phone: lead.phone ?? undefined,
          telegram: lead.telegram ?? undefined,
        });
      }
      await updateLead.mutateAsync({ id: lead.id, payload: { clientId: client.id } });
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setConvertOpen(false);
      toast.success(`Клиент «${client.name}» создан`, {
        action: {
          label: 'Открыть',
          onClick: () => navigate({ to: '/clients/$id', params: { id: client.id } }),
        },
      });
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось создать клиента'));
    } finally {
      setConverting(false);
    }
  };

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && close()}>
        <SheetContent hideClose className="overflow-y-auto p-0 sm:max-w-2xl">
          <SheetTitle className="sr-only">{leadName || 'Лид'}</SheetTitle>
          <SheetDescription className="sr-only">Карточка лида</SheetDescription>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={close}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!lead}
                onClick={() => setEditOpen(true)}
                aria-label="Редактировать лид"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!lead || createLead.isPending}
                onClick={handleDuplicate}
                aria-label="Скопировать лид"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={!lead} aria-label="Ещё">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={handleShare}>
                    <Share2 className="mr-2 h-3.5 w-3.5" />
                    Поделиться
                  </DropdownMenuItem>
                  {lead && !lead.clientId && (
                    <DropdownMenuItem onSelect={() => setConvertOpen(true)}>
                      <UserPlus className="mr-2 h-3.5 w-3.5" />
                      Перевести в клиенты
                    </DropdownMenuItem>
                  )}
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

          {isLoading || !lead ? (
            <div className="space-y-4 px-6 py-6">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <div className="space-y-6 px-6 py-6">
              <div className="space-y-2.5 pb-4">
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  Лид{lead.industry ? ` · ${lead.industry}` : ''}
                </div>
                <div className="text-[22px] font-bold leading-tight tracking-tight">
                  {lead.company || 'Компания не указана'}
                </div>
                <div className="text-[14px] text-muted-foreground">{lead.title}</div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <KanbanStatusSelect
                    statuses={leadStatuses}
                    value={lead.status}
                    onValueChange={handleStatusChange}
                    disabled={changeStatus.isPending}
                  />
                  <PriorityBadge priority={lead.priority} />
                  {lead.source && (
                    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {lead.source}
                    </span>
                  )}
                  {!isFinalLeadStatus(lead.status) && (
                    <NextContactBadge iso={lead.nextContactDate} />
                  )}
                </div>
              </div>

              {lead.clientId ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] dark:border-emerald-900 dark:bg-emerald-950/30">
                  <span className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                    <Building2 className="h-4 w-4" />
                    Лид переведён в клиенты
                  </span>
                  <Link
                    to="/clients/$id"
                    params={{ id: lead.clientId }}
                    className="font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                  >
                    Открыть клиента →
                  </Link>
                </div>
              ) : (
                lead.status === 'won' && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]">
                    <span>Сделка закрыта — заведите клиента в CRM.</span>
                    <Button size="sm" className="h-7 gap-1" onClick={() => setConvertOpen(true)}>
                      <UserPlus className="h-3.5 w-3.5" />
                      Перевести в клиенты
                    </Button>
                  </div>
                )
              )}

              <Section title="Контактное лицо">
                {lead.contactName || lead.phone || lead.email || lead.telegram ? (
                  <div className="space-y-2 rounded-lg border px-4 py-3 text-[13px]">
                    {(lead.contactName || lead.contactPosition) && (
                      <div className="flex items-center gap-2">
                        <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{lead.contactName || '—'}</span>
                        {lead.contactPosition && (
                          <span className="text-muted-foreground">· {lead.contactPosition}</span>
                        )}
                      </div>
                    )}
                    {lead.phone && (
                      <ContactLink icon={Phone} href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}>
                        {lead.phone}
                      </ContactLink>
                    )}
                    {lead.email && (
                      <ContactLink icon={Mail} href={`mailto:${lead.email}`}>
                        {lead.email}
                      </ContactLink>
                    )}
                    {lead.telegram && (
                      <ContactLink icon={Send} href={telegramHref(lead.telegram)} external>
                        {lead.telegram}
                      </ContactLink>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Контакты не указаны.{' '}
                    <button
                      type="button"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      onClick={() => setEditOpen(true)}
                    >
                      Добавить
                    </button>
                  </div>
                )}
              </Section>

              <Separator />

              <div className="grid grid-cols-1 gap-x-7 gap-y-3.5 text-sm sm:grid-cols-2">
                <Field label="Компания" value={lead.company || undefined} />
                <Field label="Отрасль" value={lead.industry} />
                <Field
                  label="Сайт"
                  value={
                    lead.website && (
                      <a
                        href={websiteHref(lead.website)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                      >
                        <Globe className="h-3.5 w-3.5" />
                        {lead.website}
                      </a>
                    )
                  }
                />
                <Field label="Источник" value={lead.source} />
                <Field
                  label="Потенциал сделки"
                  value={
                    lead.expectedValue != null && lead.expectedValue > 0
                      ? `${formatMoneyRub(lead.expectedValue)} ₽`
                      : undefined
                  }
                />
                <Field
                  label="Следующий контакт"
                  value={lead.nextContactDate ? formatDateRu(lead.nextContactDate) : undefined}
                />
                <Field
                  label="Ответственный"
                  value={
                    accountManager && (
                      <span className="flex items-center gap-1.5">
                        <UserAvatar user={accountManager} size={20} />
                        <span>{accountManager.fullName}</span>
                      </span>
                    )
                  }
                />
                <Field label="В текущем статусе" value={`${lead.daysInStatus} дн`} />
              </div>

              {lead.note && (
                <Section title="Заметки">
                  <div className="whitespace-pre-wrap rounded-lg bg-muted/40 px-3.5 py-2.5 text-[13px] leading-5">
                    {lead.note}
                  </div>
                </Section>
              )}

              <Section title="История взаимодействий">
                {activityLoading && <div className="text-xs text-muted-foreground">Загрузка…</div>}
                {activityError && !activityLoading && (
                  <div className="text-xs text-red-600">Не удалось загрузить историю.</div>
                )}
                {!activityLoading && !activityError && activityItems.length === 0 && (
                  <div className="text-xs text-muted-foreground">Записей пока нет.</div>
                )}
                <div className="flex flex-col">
                  {visibleActivity.map((entry, i, arr) => {
                    const Icon = ACTIVITY_ICON[entry.kind] ?? Plus;
                    const actor = usersData?.find((u) => u.id === entry.actorId);
                    return (
                      <div key={entry.id} className="relative flex gap-2.5 pb-3.5 last:pb-0">
                        {i < arr.length - 1 && (
                          <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
                        )}
                        <div className="z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border bg-background">
                          <Icon className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.8} />
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] leading-5">{entry.text}</div>
                          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                            {actor?.fullName ?? '—'} ·{' '}
                            {new Date(entry.createdAt).toLocaleString('ru-RU')}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hiddenActivityCount > 0 && !activityLoading && !activityError && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setActivityExpanded((prev) => !prev)}
                  >
                    {activityExpanded ? 'Свернуть' : `Показать ещё ${hiddenActivityCount}`}
                  </Button>
                )}
              </Section>

              <Separator />

              <CommentsSection entityType="lead" entityId={lead.id} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Редактирование лида</SheetTitle>
            <SheetDescription>Изменения сохраняются в карточке и на канбан-доске.</SheetDescription>
          </SheetHeader>
          {lead && (
            <LeadForm
              key={lead.id}
              defaultValues={leadToForm(lead)}
              onSubmit={handleEdit}
              isPending={updateLead.isPending}
              onCancel={() => setEditOpen(false)}
            />
          )}
        </SheetContent>
      </Sheet>

      <LeadFinalStatusDialog
        open={finalStatusTarget !== null}
        targetStatus={finalStatusTarget}
        pending={changeStatus.isPending}
        onOpenChange={(o) => {
          if (!o && !changeStatus.isPending) setFinalStatusTarget(null);
        }}
        onConfirm={(comment) => {
          if (finalStatusTarget) commitStatusChange(finalStatusTarget, comment);
        }}
      />

      <Dialog open={convertOpen} onOpenChange={(o) => !converting && setConvertOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Перевести в клиенты?</DialogTitle>
            <DialogDescription>
              {lead && (
                <>
                  Будет создан клиент «
                  <span className="font-medium text-foreground">{lead.company || lead.title}</span>»
                  {lead.contactName ? (
                    <>
                      {' '}
                      с контактом{' '}
                      <span className="font-medium text-foreground">{lead.contactName}</span>
                    </>
                  ) : null}
                  . Лид останется на доске со ссылкой на клиента.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConvertOpen(false)} disabled={converting}>
              Отмена
            </Button>
            <Button onClick={handleConvert} disabled={converting}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              {converting ? 'Создание…' : 'Создать клиента'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => !deleteLead.isPending && setDeleteOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить лид?</DialogTitle>
            <DialogDescription>
              {lead && (
                <>
                  Лид «<span className="font-medium text-foreground">{leadName}</span>» будет удалён
                  без возможности восстановления.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteLead.isPending}
            >
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLead.isPending}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {deleteLead.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ContactLink({
  icon: Icon,
  href,
  external,
  children,
}: {
  icon: LucideIcon;
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="flex w-fit items-center gap-2 text-blue-600 hover:underline dark:text-blue-400"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="tnum">{children}</span>
    </a>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="break-words">{value || '—'}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
