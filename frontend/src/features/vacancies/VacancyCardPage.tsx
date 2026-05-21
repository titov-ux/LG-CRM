import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Copy, Edit3, MoreHorizontal, Plus, Share2, Trash2, X } from 'lucide-react';
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
import { StackTags } from '@/components/common/StackTags';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { KanbanStatusSelect } from '@/components/kanban/KanbanStatusSelect';
import type { VacancyStatus } from '@/api/types';
import {
  useChangeVacancyStatus,
  useCreateVacancy,
  useDeleteVacancy,
  useUpdateVacancy,
  useVacancy,
} from './hooks';
import { VacancyForm, type VacancyFormValues } from './VacancyForm';
import { useClients } from '@/features/clients/hooks';
import { useUsers } from '@/features/users/hooks';
import { useCandidates } from '@/features/candidates/hooks';
import { vacancyStatuses } from '@/mocks/db/vacancies';
import { formatDateRu, formatMoneyRub } from '@/lib/utils';
import type { Vacancy } from '@/api/types';
import { CommentsSection } from '@/features/comments/CommentsSection';
import { AttachCandidateDialog } from '@/features/matching/AttachCandidateDialog';
import { useAttachCandidate, useDetachCandidate } from '@/features/matching/hooks';

function splitStack(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toDuplicatePayload(vacancy: Vacancy): Partial<Vacancy> {
  return {
    title: `${vacancy.title} (копия)`,
    clientId: vacancy.clientId,
    project: vacancy.project,
    grade: vacancy.grade,
    format: vacancy.format,
    priority: vacancy.priority,
    rateClient: vacancy.rateClient,
    positions: vacancy.positions,
    stack: [...vacancy.stack],
    deadline: vacancy.deadline,
    accountManagerId: vacancy.accountManagerId,
    recruiterIds: [...vacancy.recruiterIds],
    status: 'new',
    description: vacancy.description,
    requirements: vacancy.requirements,
  };
}

function toFormValues(vacancy: Vacancy): Partial<VacancyFormValues> {
  return {
    title: vacancy.title,
    clientId: vacancy.clientId,
    project: vacancy.project ?? '',
    grade: vacancy.grade,
    format: vacancy.format,
    priority: vacancy.priority,
    rateClient: vacancy.rateClient,
    positions: vacancy.positions,
    stack: vacancy.stack.join(', '),
    deadline: vacancy.deadline ?? '',
    accountManagerId: vacancy.accountManagerId,
    recruiterId: vacancy.recruiterIds[0] ?? '',
    description: vacancy.description ?? '',
    requirements: vacancy.requirements ?? '',
  };
}

export function VacancyCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/vacancies/$id' });
  const { data: vacancy, isLoading } = useVacancy(id);
  const { data: clientsData } = useClients();
  const { data: usersData } = useUsers();
  const { data: candidatesData } = useCandidates();
  const updateVacancy = useUpdateVacancy();
  const createVacancy = useCreateVacancy();
  const changeStatus = useChangeVacancyStatus();
  const deleteVacancy = useDeleteVacancy();
  const detachCandidate = useDetachCandidate();
  const attachCandidate = useAttachCandidate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

  const close = () => navigate({ to: '/vacancies' });
  const client = clientsData?.items.find((c) => c.id === vacancy?.clientId);
  // АМ берётся с самой вакансии; на старых записях без поля — fallback на АМ клиента.
  const accountManagerId = vacancy?.accountManagerId || client?.accountManagerId;
  const accountManager = usersData?.find((u) => u.id === accountManagerId);
  const attached = (candidatesData?.items ?? []).filter((c) => vacancy && c.vacancyIds.includes(vacancy.id));

  const handleStatusChange = (status: VacancyStatus) => {
    if (!vacancy || status === vacancy.status) return;
    changeStatus.mutate(
      { id: vacancy.id, status },
      {
        onSuccess: (v) => toast.success(`Вакансия «${v.title}» — статус изменён`),
        onError: () => toast.error('Не удалось изменить статус'),
      },
    );
  };

  const handleShare = async () => {
    if (!vacancy) return;
    const link = `${window.location.origin}/vacancies/${vacancy.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Ссылка на вакансию скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };

  const handleDelete = () => {
    if (!vacancy) return;
    deleteVacancy.mutate(vacancy.id, {
      onSuccess: () => {
        toast.success(`Вакансия «${vacancy.title}» удалена`);
        setDeleteOpen(false);
        navigate({ to: '/vacancies' });
      },
      onError: () => toast.error('Не удалось удалить вакансию'),
    });
  };

  const handleCopy = () => {
    if (!vacancy) return;
    createVacancy.mutate(toDuplicatePayload(vacancy), {
      onSuccess: (v) => {
        toast.success(`Создана копия «${v.title}»`);
        navigate({ to: '/vacancies/$id', params: { id: v.id } });
      },
      onError: () => toast.error('Не удалось скопировать вакансию'),
    });
  };

  const handleDetachCandidate = (candidateId: string, candidateName: string) => {
    if (!vacancy) return;
    detachCandidate.mutate(
      { vacancyId: vacancy.id, candidateId },
      {
        onSuccess: () => {
          toast.success(`${candidateName} откреплён от вакансии`, {
            action: {
              label: 'Вернуть',
              onClick: () => attachCandidate.mutate({ vacancyId: vacancy.id, candidateId }),
            },
          });
        },
        onError: () => toast.error('Не удалось открепить кандидата'),
      },
    );
  };

  const handleEdit = (values: VacancyFormValues) => {
    if (!vacancy) return;
    const payload = {
      title: values.title,
      clientId: values.clientId,
      project: values.project?.trim() || undefined,
      grade: values.grade,
      format: values.format,
      priority: values.priority,
      rateClient: Number(values.rateClient),
      positions: Number(values.positions),
      stack: splitStack(values.stack),
      deadline: values.deadline || null,
      accountManagerId: values.accountManagerId,
      recruiterIds: values.recruiterId ? [values.recruiterId] : [],
      description: values.description?.trim() || undefined,
      requirements: values.requirements?.trim() || undefined,
    };
    updateVacancy.mutate(
      { id: vacancy.id, payload },
      {
        onSuccess: (v) => {
          toast.success(`Вакансия «${v.title}» обновлена`);
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
            <Button variant="ghost" size="icon" onClick={close}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!vacancy}
              onClick={() => setEditOpen(true)}
              aria-label="Редактировать вакансию"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!vacancy || createVacancy.isPending}
              onClick={handleCopy}
              aria-label="Скопировать вакансию"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={!vacancy} aria-label="Ещё">
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

        {isLoading || !vacancy ? (
          <div className="space-y-4 px-6 py-6">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="space-y-6 px-6 py-6">
            <div className="space-y-2.5 pb-4">
              <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Вакансия · {client?.name}
              </div>
              <div className="text-[22px] font-bold leading-tight tracking-tight">{vacancy.title}</div>
              <div className="flex flex-wrap items-center gap-2">
                <KanbanStatusSelect
                  statuses={vacancyStatuses}
                  value={vacancy.status}
                  onValueChange={handleStatusChange}
                  disabled={changeStatus.isPending}
                />
                <PriorityBadge priority={vacancy.priority} />
                <span className="text-xs text-muted-foreground">
                  {vacancy.grade} · {vacancy.format}
                </span>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-x-7 gap-y-3.5 text-sm">
              <Field label="Клиент" value={client?.name} />
              <Field label="Проект" value={vacancy.project} />
              <Field
                label="Аккаунт-менеджер"
                value={
                  accountManager && (
                    <span className="flex items-center gap-1.5">
                      <UserAvatar user={accountManager} size={20} />
                      <span>{accountManager.fullName}</span>
                    </span>
                  )
                }
              />
              <Field label="Ставка для клиента" value={`${formatMoneyRub(vacancy.rateClient)} ₽/час`} />
              <Field label="Позиций" value={vacancy.positions} />
              <Field label="Дедлайн" value={formatDateRu(vacancy.deadline)} />
            </div>

            {vacancy.description && (
              <Section title="Описание вакансии">
                <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/90">
                  {vacancy.description}
                </p>
              </Section>
            )}

            {vacancy.requirements && (
              <Section title="Требования">
                <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/90">
                  {vacancy.requirements}
                </p>
              </Section>
            )}

            <Section title="Стек технологий">
              <StackTags stack={vacancy.stack} variant="accent" />
            </Section>

            <Section title="Назначенные рекрутеры">
              {vacancy.recruiterIds.length === 0 ? (
                <span className="text-xs text-muted-foreground">Не назначены</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {vacancy.recruiterIds.map((rid) => {
                    const u = usersData?.find((x) => x.id === rid);
                    if (!u) return null;
                    return (
                      <div key={rid} className="flex items-center gap-1.5 rounded-full bg-muted py-1 pl-1 pr-3">
                        <UserAvatar user={u} size={20} />
                        <span className="text-xs">{u.fullName}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section
              title={`Прикреплённые кандидаты · ${attached.length}`}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setAttachOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Прикрепить
                </Button>
              }
            >
              {attached.length === 0 ? (
                <div className="py-2 text-xs text-muted-foreground">Кандидаты пока не прикреплены.</div>
              ) : (
                <div className="space-y-1.5">
                  {attached.map((c) => (
                    <div
                      key={c.id}
                      className="group flex items-center rounded-md border bg-muted/30 hover:bg-muted"
                    >
                      <button
                        type="button"
                        onClick={() => navigate({ to: '/candidates/$id', params: { id: c.id } })}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
                      >
                        <UserAvatar
                          user={{ fullName: c.fullName, initials: c.fullName.split(' ').map((p) => p[0]).slice(0, 2).join(''), color: '#475569' }}
                          size={26}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold">{c.fullName}</div>
                          <div className="truncate text-[11.5px] text-muted-foreground">{c.role}</div>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1 pr-2">
                        <span className="tnum text-xs font-semibold">{formatMoneyRub(c.rate)} ₽</span>
                        <button
                          type="button"
                          onClick={() => handleDetachCandidate(c.id, c.fullName)}
                          disabled={detachCandidate.isPending}
                          aria-label={`Открепить ${c.fullName}`}
                          title="Открепить от вакансии"
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Separator />

            <CommentsSection entityType="vacancy" entityId={vacancy.id} />
          </div>
        )}
      </SheetContent>
    </Sheet>

    <Sheet open={editOpen} onOpenChange={setEditOpen}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader className="mb-4">
          <SheetTitle>Редактирование вакансии</SheetTitle>
          <SheetDescription>Изменения сохраняются в карточке и на канбан-доске.</SheetDescription>
        </SheetHeader>
        {vacancy && (
          <VacancyForm
            key={vacancy.id}
            defaultValues={toFormValues(vacancy)}
            onSubmit={handleEdit}
            isPending={updateVacancy.isPending}
          />
        )}
      </SheetContent>
    </Sheet>

    <Dialog open={deleteOpen} onOpenChange={(o) => !deleteVacancy.isPending && setDeleteOpen(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Удалить вакансию?</DialogTitle>
          <DialogDescription>
            {vacancy && (
              <>
                Вакансия «<span className="font-medium text-foreground">{vacancy.title}</span>» будет удалена без возможности
                восстановления. Прикреплённые кандидаты останутся в системе.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteVacancy.isPending}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteVacancy.isPending}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {deleteVacancy.isPending ? 'Удаление…' : 'Удалить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {vacancy && (
      <AttachCandidateDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        vacancyId={vacancy.id}
        excludeIds={attached.map((c) => c.id)}
      />
    )}
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
