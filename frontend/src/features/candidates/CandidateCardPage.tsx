import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowRight, ChevronLeft, Copy, Edit3, Mail, MessageCircle, MoreHorizontal, Phone, Plus, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import { StackTags } from '@/components/common/StackTags';
import { KanbanStatusSelect } from '@/components/kanban/KanbanStatusSelect';
import type { Candidate, CandidateStatus } from '@/api/types';
import { formatMoneyRub } from '@/lib/utils';
import { CandidateForm, type CandidateFormValues } from './CandidateForm';
import {
  useCandidate,
  useCandidateActivity,
  useChangeCandidateStatus,
  useCreateCandidate,
  useUpdateCandidate,
} from './hooks';
import { useUsers } from '@/features/users/hooks';
import { candidateStatuses } from '@/mocks/db/candidates';

function splitStack(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toFormValues(candidate: Candidate): Partial<CandidateFormValues> {
  return {
    fullName: candidate.fullName,
    role: candidate.role,
    grade: candidate.grade,
    experienceYears: candidate.experienceYears,
    format: candidate.format,
    rate: candidate.rate,
    recruiterId: candidate.recruiterId,
    location: candidate.location,
    source: candidate.source,
    email: candidate.email ?? '',
    phone: candidate.phone ?? '',
    stack: candidate.stack.join(', '),
  };
}

function toDuplicatePayload(candidate: Candidate): Partial<Candidate> {
  return {
    fullName: `${candidate.fullName} (копия)`,
    role: candidate.role,
    grade: candidate.grade,
    experienceYears: candidate.experienceYears,
    stack: [...candidate.stack],
    rate: candidate.rate,
    format: candidate.format,
    location: candidate.location,
    source: candidate.source,
    recruiterId: candidate.recruiterId,
    status: 'new',
    email: candidate.email,
    phone: candidate.phone,
    vacancyIds: [...candidate.vacancyIds],
    hot: candidate.hot,
  };
}

const ACTIVITY_ICON: Record<string, LucideIcon> = {
  status: ArrowRight,
  note: MessageCircle,
  call: Phone,
  email: Mail,
  create: Plus,
};

export function CandidateCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/candidates/$id' });
  const [editOpen, setEditOpen] = useState(false);
  const { data: candidate, isLoading } = useCandidate(id);
  const { data: activity } = useCandidateActivity(id);
  const { data: usersData } = useUsers();
  const changeStatus = useChangeCandidateStatus();
  const createCandidate = useCreateCandidate();
  const updateCandidate = useUpdateCandidate();

  const close = () => navigate({ to: '/candidates' });
  const recruiter = usersData?.find((u) => u.id === candidate?.recruiterId);

  const handleCopy = () => {
    if (!candidate) return;
    createCandidate.mutate(toDuplicatePayload(candidate), {
      onSuccess: (c) => {
        toast.success(`Создана копия «${c.fullName}»`);
        navigate({ to: '/candidates/$id', params: { id: c.id } });
      },
      onError: () => toast.error('Не удалось скопировать кандидата'),
    });
  };

  const handleEdit = (values: CandidateFormValues) => {
    if (!candidate) return;
    updateCandidate.mutate(
      {
        id: candidate.id,
        payload: {
          fullName: values.fullName,
          role: values.role,
          grade: values.grade,
          experienceYears: Number(values.experienceYears),
          format: values.format,
          rate: Number(values.rate),
          recruiterId: values.recruiterId,
          location: values.location || '',
          source: values.source || '',
          email: values.email || undefined,
          phone: values.phone || undefined,
          stack: splitStack(values.stack),
        },
      },
      {
        onSuccess: (c) => {
          toast.success(`Кандидат «${c.fullName}» обновлён`);
          setEditOpen(false);
        },
        onError: () => toast.error('Не удалось сохранить изменения'),
      },
    );
  };

  const handleStatusChange = (status: CandidateStatus) => {
    if (!candidate || status === candidate.status) return;
    changeStatus.mutate(
      { id: candidate.id, status },
      {
        onSuccess: (c) => toast.success(`Кандидат «${c.fullName}» — статус изменён`),
        onError: () => toast.error('Не удалось изменить статус'),
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
              disabled={!candidate}
              onClick={() => setEditOpen(true)}
              aria-label="Редактировать кандидата"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!candidate || createCandidate.isPending}
              onClick={handleCopy}
              aria-label="Скопировать кандидата"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
          </div>
          <Button variant="ghost" size="icon" onClick={close}><X className="h-3.5 w-3.5" /></Button>
        </div>

        {isLoading || !candidate ? (
          <div className="space-y-4 px-6 py-6">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <div className="space-y-6 px-6 py-6">
            <div className="space-y-2.5 pb-4">
              <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Кандидат · {candidate.grade}
              </div>
              <div className="flex items-center gap-3.5">
                <UserAvatar
                  user={{
                    fullName: candidate.fullName,
                    initials: candidate.fullName.split(' ').map((p) => p[0]).slice(0, 2).join(''),
                    color: '#475569',
                  }}
                  size={48}
                />
                <div>
                  <div className="text-[22px] font-bold leading-tight tracking-tight">{candidate.fullName}</div>
                  <div className="text-sm text-muted-foreground">{candidate.role}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <KanbanStatusSelect
                  statuses={candidateStatuses}
                  value={candidate.status}
                  onValueChange={handleStatusChange}
                  disabled={changeStatus.isPending}
                />
                <span className="text-xs text-muted-foreground">
                  {candidate.experienceYears} лет опыта · {candidate.location}
                </span>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-x-7 gap-y-3.5 text-sm">
              <Field label="Email" value={candidate.email && <span className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-muted-foreground" />{candidate.email}</span>} />
              <Field label="Телефон" value={candidate.phone && <span className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground" />{candidate.phone}</span>} />
              <Field label="Ожидаемая ставка" value={<span className="font-semibold">{formatMoneyRub(candidate.rate)} ₽/час</span>} />
              <Field label="Формат работы" value={candidate.format} />
              <Field label="Источник" value={candidate.source} />
              <Field
                label="Ответственный рекрутер"
                value={
                  recruiter && (
                    <span className="flex items-center gap-1.5">
                      <UserAvatar user={recruiter} size={20} />
                      <span>{recruiter.fullName}</span>
                    </span>
                  )
                }
              />
            </div>

            <Section title="Стек технологий"><StackTags stack={candidate.stack} variant="accent" /></Section>

            <Section title="История взаимодействий">
              {(!activity || activity.length === 0) && (
                <div className="text-xs text-muted-foreground">Записей пока нет.</div>
              )}
              <div className="flex flex-col">
                {(activity ?? []).map((entry, i, arr) => {
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
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>

    <Sheet open={editOpen} onOpenChange={setEditOpen}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader className="mb-4">
          <SheetTitle>Редактирование кандидата</SheetTitle>
          <SheetDescription>Изменения сохраняются в карточке и на канбан-доске.</SheetDescription>
        </SheetHeader>
        {candidate && (
          <CandidateForm
            key={candidate.id}
            defaultValues={toFormValues(candidate)}
            onSubmit={handleEdit}
            isPending={updateCandidate.isPending}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
