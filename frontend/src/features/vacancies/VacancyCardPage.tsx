import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowRight, ChevronLeft, ClipboardCopy, Copy, Edit3, Mail, MessageCircle, MoreHorizontal, Phone, Plus, Share2, Trash2, UserPlus, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { EngagementBadge } from '@/components/common/EngagementBadge';
import { KanbanStatusSelect } from '@/components/kanban/KanbanStatusSelect';
import type { VacancyStatus } from '@/api/types';
import {
  useChangeVacancyStatus,
  useCreateVacancy,
  useDeleteVacancy,
  useUpdateVacancy,
  useVacancy,
  useVacancyActivity,
} from './hooks';
import { VacancyForm, type VacancyFormValues } from './VacancyForm';
import { useClients } from '@/features/clients/hooks';
import { useUsers } from '@/features/users/hooks';
import { useCandidates } from '@/features/candidates/hooks';
import { vacancyStatuses } from '@/mocks/db/vacancies';
import { formatDateRu, formatMoneyRub } from '@/lib/utils';
import type { Vacancy } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { CommentsSection } from '@/features/comments/CommentsSection';
import { AttachCandidateDialog } from '@/features/matching/AttachCandidateDialog';
import { useAttachCandidate, useDetachCandidate } from '@/features/matching/hooks';
import { MatchCompensationRow } from '@/features/matching/MatchCompensationRow';
import { DEFAULT_HOURS_PER_MONTH, vacancyMaxNetSalary } from '@/lib/compensation';

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
    engagementType: vacancy.engagementType,
    project: vacancy.project,
    grade: vacancy.grade,
    format: vacancy.format,
    priority: vacancy.priority,
    rateClient: vacancy.rateClient,
    salaryMax: vacancy.salaryMax,
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

const ACTIVITY_ICON: Record<string, LucideIcon> = {
  status: ArrowRight,
  note: MessageCircle,
  call: Phone,
  email: Mail,
  create: Plus,
};
const ACTIVITY_PREVIEW_LIMIT = 5;

function toFormValues(vacancy: Vacancy): Partial<VacancyFormValues> {
  return {
    title: vacancy.title,
    clientId: vacancy.clientId,
    engagementType: vacancy.engagementType,
    project: vacancy.project ?? '',
    grade: vacancy.grade,
    format: vacancy.format,
    priority: vacancy.priority,
    rateClient: vacancy.rateClient,
    salaryMax: vacancy.salaryMax ?? undefined,
    positions: vacancy.positions,
    stack: vacancy.stack.join(', '),
    deadline: vacancy.deadline ?? '',
    accountManagerId: vacancy.accountManagerId,
    recruiterIds: [...vacancy.recruiterIds],
    description: vacancy.description ?? '',
    requirements: vacancy.requirements ?? '',
  };
}

export function VacancyCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/vacancies/$id' });
  const { data: vacancy, isLoading } = useVacancy(id);
  const { data: activity, isLoading: activityLoading, isError: activityError } = useVacancyActivity(id);
  const { data: clientsData } = useClients();
  const { data: usersData } = useUsers();
  const { data: candidatesData } = useCandidates();
  const currentUser = useAuthStore((s) => s.user);
  const updateVacancy = useUpdateVacancy();
  const createVacancy = useCreateVacancy();
  const changeStatus = useChangeVacancyStatus();
  const deleteVacancy = useDeleteVacancy();
  const detachCandidate = useDetachCandidate();
  const attachCandidate = useAttachCandidate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const hoursPerMonth = DEFAULT_HOURS_PER_MONTH;

  const close = () => navigate({ to: '/vacancies' });
  const client = clientsData?.items.find((c) => c.id === vacancy?.clientId);
  // АМ берётся с самой вакансии; на старых записях без поля — fallback на АМ клиента.
  const accountManagerId = vacancy?.accountManagerId || client?.accountManagerId;
  const accountManager = usersData?.find((u) => u.id === accountManagerId);
  const attached = (candidatesData?.items ?? []).filter((c) => vacancy && c.vacancyIds.includes(vacancy.id));
  const activityItems = activity ?? [];
  const hiddenActivityCount = Math.max(activityItems.length - ACTIVITY_PREVIEW_LIMIT, 0);
  const visibleActivity = activityExpanded ? activityItems : activityItems.slice(0, ACTIVITY_PREVIEW_LIMIT);

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

  // Текст вакансии для отправки кандидату в мессенджер.
  // Включает только содержательные блоки (проект, описание, требования);
  // пустые поля пропускаются, чтобы не отправлять кандидату «голые» заголовки.
  const buildCandidateText = (v: Vacancy): string => {
    const blocks: string[] = [];
    blocks.push(v.title);
    if (v.project?.trim()) {
      blocks.push(`Проект: ${v.project.trim()}`);
    }
    if (v.description?.trim()) {
      blocks.push(`Описание вакансии:\n${v.description.trim()}`);
    }
    if (v.requirements?.trim()) {
      blocks.push(`Требования:\n${v.requirements.trim()}`);
    }
    return blocks.join('\n\n');
  };

  const handleCopyForCandidate = async () => {
    if (!vacancy) return;
    const text = buildCandidateText(vacancy);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Текст вакансии скопирован — можно отправлять кандидату');
    } catch {
      toast.error('Не удалось скопировать текст вакансии');
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

  const canSelfAssignRecruiter = Boolean(
    currentUser &&
      (currentUser.role === 'admin' || currentUser.role === 'recruiter') &&
      vacancy &&
      !vacancy.recruiterIds.includes(currentUser.id),
  );

  const handleAssignSelfAsRecruiter = () => {
    if (!vacancy || !currentUser) return;
    if (vacancy.recruiterIds.includes(currentUser.id)) return;
    const nextRecruiterIds = [...vacancy.recruiterIds, currentUser.id];
    updateVacancy.mutate(
      { id: vacancy.id, payload: { recruiterIds: nextRecruiterIds } },
      {
        onSuccess: () => toast.success('Вы назначены рекрутером по вакансии'),
        onError: () => toast.error('Не удалось назначить себя рекрутером'),
      },
    );
  };

  const handleEdit = (values: VacancyFormValues) => {
    if (!vacancy) return;
    const isAgency = values.engagementType === 'agency';
    const payload = {
      title: values.title,
      clientId: values.clientId,
      engagementType: values.engagementType,
      project: values.project?.trim() || undefined,
      grade: values.grade,
      format: values.format,
      priority: values.priority,
      // Для аутстаффа ведём почасовую ставку, для агентства — опциональный оклад «до».
      rateClient: isAgency ? 0 : Number(values.rateClient ?? 0),
      // Явный null при outstaff → бэкенд/мок чистит залипшее значение от прошлой агентской версии.
      salaryMax: isAgency ? (values.salaryMax != null ? Number(values.salaryMax) : null) : null,
      positions: Number(values.positions),
      stack: splitStack(values.stack),
      deadline: values.deadline || null,
      accountManagerId: values.accountManagerId,
      recruiterIds: values.recruiterIds ?? [],
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
            <Button
              variant="ghost"
              size="icon"
              disabled={!vacancy}
              onClick={handleCopyForCandidate}
              aria-label="Скопировать текст для кандидата"
              title="Скопировать текст для кандидата"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
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
                <EngagementBadge type={vacancy.engagementType} variant="chip" />
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
              {vacancy.engagementType === 'agency' ? (
                <Field
                  label="Оклад до"
                  value={
                    vacancy.salaryMax ? `${formatMoneyRub(vacancy.salaryMax)} ₽/мес` : undefined
                  }
                />
              ) : (
                <>
                  <Field label="Ставка для клиента" value={`${formatMoneyRub(vacancy.rateClient)} ₽/час`} />
                  <Field
                    label="Оклад до (на руки)"
                    value={
                      vacancy.rateClient > 0 ? (
                        <span className="flex flex-col gap-0.5 text-[13px] leading-tight">
                          <span>
                            <span className="text-muted-foreground">ИП / СМЗ:</span>{' '}
                            {formatMoneyRub(
                              vacancyMaxNetSalary({
                                rateClient: vacancy.rateClient,
                                employmentType: 'ИП',
                                hoursPerMonth,
                              }),
                            )}{' '}
                            ₽/мес
                          </span>
                          <span>
                            <span className="text-muted-foreground">ТК РФ:</span>{' '}
                            {formatMoneyRub(
                              vacancyMaxNetSalary({
                                rateClient: vacancy.rateClient,
                                employmentType: 'ТК РФ',
                                hoursPerMonth,
                              }),
                            )}{' '}
                            ₽/мес
                          </span>
                        </span>
                      ) : undefined
                    }
                  />
                </>
              )}
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

            <Section
              title="Назначенные рекрутеры"
              action={
                canSelfAssignRecruiter ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={handleAssignSelfAsRecruiter}
                    disabled={updateVacancy.isPending}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Назначить себя
                  </Button>
                ) : null
              }
            >
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
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setAttachOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Прикрепить
                  </Button>
                </div>
              }
            >
              {attached.length === 0 ? (
                <div className="py-2 text-xs text-muted-foreground">Кандидаты пока не прикреплены.</div>
              ) : (
                <div className="space-y-1.5">
                  {attached.map((c) => (
                    <MatchCompensationRow
                      key={c.id}
                      vacancy={vacancy}
                      candidate={c}
                      hoursPerMonth={hoursPerMonth}
                      onOpen={() => navigate({ to: '/candidates/$id', params: { id: c.id } })}
                      onDetach={() => handleDetachCandidate(c.id, c.fullName)}
                      detachDisabled={detachCandidate.isPending}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section title="История взаимодействий">
              {activityLoading && (
                <div className="text-xs text-muted-foreground">Загрузка…</div>
              )}
              {activityError && !activityLoading && (
                <div className="text-xs text-red-600">Не удалось загрузить историю.</div>
              )}
              {!activityLoading && !activityError && (!activity || activity.length === 0) && (
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
                          {actor?.fullName ?? '—'} · {new Date(entry.createdAt).toLocaleString('ru-RU')}
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
