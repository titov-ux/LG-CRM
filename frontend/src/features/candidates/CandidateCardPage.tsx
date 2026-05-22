import { useState } from 'react';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  ArchiveRestore,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  FileDown,
  Inbox,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Share2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { EngagementBadge } from '@/components/common/EngagementBadge';
import { KanbanStatusSelect } from '@/components/kanban/KanbanStatusSelect';
import type {
  Candidate,
  CandidateCertification,
  CandidateEducation,
  CandidateExperience,
  CandidateLanguage,
  CandidateStatus,
  SkillCategory,
} from '@/api/types';
import { formatMoneyRub, telegramUrl } from '@/lib/utils';
import { CandidateForm, type CandidateFormValues } from './CandidateForm';
import {
  useArchiveCandidate,
  useCandidate,
  useCandidateActivity,
  useChangeCandidateStatus,
  useCreateCandidate,
  useRestoreCandidate,
  useUpdateCandidate,
} from './hooks';
import { useCan } from '@/lib/permissions';
import { Textarea } from '@/components/ui/textarea';
import { useUsers } from '@/features/users/hooks';
import { useVacancies } from '@/features/vacancies/hooks';
import { useClients } from '@/features/clients/hooks';
import { candidateStatuses } from '@/mocks/db/candidates';
import { CommentsSection } from '@/features/comments/CommentsSection';
import { AttachVacancyDialog } from '@/features/matching/AttachVacancyDialog';
import { useAttachCandidate, useDetachCandidate } from '@/features/matching/hooks';
import {
  downloadResumePdf,
  generateResumeDocxBlob,
  generateResumeDocxBlobKhronyuk,
  resumeFileName,
  resumeFileNameKhronyuk,
} from './resume';
import { candidateDraftStorage } from './draftStorage';

function splitStack(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitLines(value: string | undefined): string[] {
  return (value ?? '')
    .split(/\r?\n/)
    .map((s) => s.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
}

const MONTH_NAMES_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

function formatMonth(value: string | null | undefined): string {
  if (!value) return 'наст. время';
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return value;
  return `${MONTH_NAMES_RU[month - 1]} ${m[1]}`;
}

function formatPeriod(start: string, end: string | null | undefined): string {
  return `${formatMonth(start)} — ${formatMonth(end ?? null)}`;
}

function toFormValues(candidate: Candidate): Partial<CandidateFormValues> {
  return {
    fullName: candidate.fullName,
    role: candidate.role,
    engagementType: candidate.engagementType,
    grade: candidate.grade,
    experienceYears: candidate.experienceYears,
    format: candidate.format,
    rateMonth: candidate.rateMonth,
    employmentType: candidate.employmentType,
    recruiterId: candidate.recruiterId,
    location: candidate.location,
    birthday: candidate.birthday ?? '',
    telegram: candidate.telegram ?? '',
    phone: candidate.phone ?? '',
    email: candidate.email ?? '',
    stack: candidate.stack.join(', '),
    summary: candidate.summary ?? '',
    skillCategories: (candidate.skillCategories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      itemsText: c.items.join(', '),
    })),
    experience: (candidate.experience ?? []).map((e) => ({
      id: e.id,
      company: e.company,
      position: e.position,
      startMonth: e.startMonth,
      endMonth: e.endMonth ?? '',
      project: e.project ?? '',
      achievementsText: e.achievements.join('\n'),
      stackText: e.stack.join(', '),
    })),
    education: (candidate.education ?? []).map((e) => ({
      id: e.id,
      degree: e.degree,
      institution: e.institution,
      city: e.city ?? '',
      graduationYear: e.graduationYear,
      specialty: e.specialty ?? '',
    })),
    certifications: (candidate.certifications ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      issuer: c.issuer,
      period: c.period ?? '',
    })),
    languages: candidate.languages ?? [],
  };
}

function toDuplicatePayload(candidate: Candidate): Partial<Candidate> {
  return {
    fullName: `${candidate.fullName} (копия)`,
    role: candidate.role,
    engagementType: candidate.engagementType,
    grade: candidate.grade,
    experienceYears: candidate.experienceYears,
    stack: [...candidate.stack],
    rateMonth: candidate.rateMonth,
    employmentType: candidate.employmentType,
    format: candidate.format,
    location: candidate.location,
    birthday: candidate.birthday,
    recruiterId: candidate.recruiterId,
    status: 'new',
    telegram: candidate.telegram,
    phone: candidate.phone,
    email: candidate.email,
    vacancyIds: [...candidate.vacancyIds],
    summary: candidate.summary,
    skillCategories: candidate.skillCategories?.map((c) => ({ ...c, items: [...c.items] })),
    experience: candidate.experience?.map((e) => ({
      ...e,
      achievements: [...e.achievements],
      stack: [...e.stack],
    })),
    education: candidate.education?.map((e) => ({ ...e })),
    certifications: candidate.certifications?.map((c) => ({ ...c })),
    languages: candidate.languages?.map((l) => ({ ...l })),
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

export interface CandidateCardPageProps {
  /**
   * Откуда открыта карточка. Влияет на «возврат назад», на лимит истории
   * и на наличие отдельной секции «История статусов».
   *   - 'board'    — открыта с канбан-доски `/candidates`;
   *   - 'database' — открыта из раздела `/database` («База кандидатов»).
   */
  source?: 'board' | 'database';
}

export function CandidateCardPage({ source: sourceProp }: CandidateCardPageProps = {}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Если проп не задан, угадываем по URL. Это упрощает реюз компонента
  // в обоих route-файлах (/candidates/$id и /database/$id).
  const source: 'board' | 'database' =
    sourceProp ?? (pathname.startsWith('/database') ? 'database' : 'board');
  const fromDatabase = source === 'database';
  const idParams = useParams({ strict: false }) as { id?: string };
  const id = idParams.id ?? '';
  const [editOpen, setEditOpen] = useState(false);
  const { data: candidate, isLoading } = useCandidate(id);
  const { data: activity } = useCandidateActivity(id);
  const { data: usersData } = useUsers();
  const { data: vacanciesData } = useVacancies();
  const { data: clientsData } = useClients();
  const changeStatus = useChangeCandidateStatus();
  const createCandidate = useCreateCandidate();
  const updateCandidate = useUpdateCandidate();
  const archiveCandidate = useArchiveCandidate();
  const restoreCandidate = useRestoreCandidate();
  const detachCandidate = useDetachCandidate();
  const attachCandidate = useAttachCandidate();
  const canArchive = useCan('candidate:archive');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(fromDatabase);

  // Закрытие карточки возвращает на тот же раздел, откуда её открыли.
  const close = () => navigate({ to: fromDatabase ? '/database' : '/candidates' });
  const recruiter = usersData?.find((u) => u.id === candidate?.recruiterId);
  const attachedVacancies = (vacanciesData?.items ?? []).filter(
    (v) => candidate && candidate.vacancyIds.includes(v.id),
  );
  const activityItems = activity ?? [];
  const hiddenActivityCount = Math.max(activityItems.length - ACTIVITY_PREVIEW_LIMIT, 0);
  const visibleActivity = activityExpanded ? activityItems : activityItems.slice(0, ACTIVITY_PREVIEW_LIMIT);
  /**
   * Полная история смены статусов. В разделе «База кандидатов» это
   * требование заказчика: нужно видеть все переходы со временем и автором,
   * а не только последние 5.
   */
  const statusHistory = activityItems.filter((a) => a.kind === 'status');

  const handleShare = async () => {
    if (!candidate) return;
    const link = `${window.location.origin}/candidates/${candidate.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Ссылка на кандидата скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };

  // «Убрать с доски» — кандидат остаётся в базе, но пропадает из канбана
  // и отвязывается от вакансий. Это softdelete.
  const handleArchive = () => {
    if (!candidate) return;
    const reason = archiveReason.trim();
    archiveCandidate.mutate(
      { id: candidate.id, reason: reason || undefined },
      {
        onSuccess: () => {
          toast.success(`Кандидат «${candidate.fullName}» убран с доски`, {
            description: 'В «Базе кандидатов» карточка по-прежнему доступна.',
          });
          setArchiveOpen(false);
          setArchiveReason('');
          // Если архивирование произошло на канбане — возвращаемся к доске,
          // иначе остаёмся внутри карточки в базе.
          if (!fromDatabase) navigate({ to: '/candidates' });
        },
        onError: () => toast.error('Не удалось убрать кандидата с доски'),
      },
    );
  };

  const handleRestore = () => {
    if (!candidate) return;
    restoreCandidate.mutate(candidate.id, {
      onSuccess: () => {
        toast.success(`Кандидат «${candidate.fullName}» возвращён на доску`);
      },
      onError: () => toast.error('Не удалось восстановить кандидата'),
    });
  };

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

  // Генерация резюме. У кандидата должна быть заполнена хотя бы шапка —
  // ФИО плюс что-то ещё; иначе шаблон получится пустым. Кнопка остаётся
  // активной всегда (формальный минимум есть у любого кандидата), но
  // на сбой генерации показываем явный тост.
  const handleDownloadDocx = async () => {
    if (!candidate) return;
    try {
      const blob = await generateResumeDocxBlob(candidate);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resumeFileName(candidate, 'docx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Освобождаем URL чуть позже — некоторые браузеры успевают отозвать
      // ссылку до того, как стартует загрузка.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Резюме DOCX сформировано');
    } catch (e) {
      console.error(e);
      toast.error('Не удалось сформировать DOCX');
    }
  };

  /**
   * Альтернативный шаблон резюме «для МБ» (Хронюк/Цифровые привычки):
   * красные заголовки, весь текст жирный, Calibri. Использует тот же
   * механизм, что и обычный DOCX-экспорт, только другой генератор.
   */
  const handleDownloadDocxMB = async () => {
    if (!candidate) return;
    try {
      const blob = await generateResumeDocxBlobKhronyuk(candidate);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resumeFileNameKhronyuk(candidate);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Резюме для МБ сформировано');
    } catch (e) {
      console.error(e);
      toast.error('Не удалось сформировать DOCX для МБ');
    }
  };

  const [pdfPending, setPdfPending] = useState(false);
  const handleDownloadPdf = async () => {
    if (!candidate) return;
    setPdfPending(true);
    try {
      await downloadResumePdf(candidate);
      toast.success('Резюме PDF сформировано');
    } catch (e) {
      console.error(e);
      toast.error('Не удалось сформировать PDF');
    } finally {
      setPdfPending(false);
    }
  };

  const handleDetachVacancy = (vacancyId: string, vacancyTitle: string) => {
    if (!candidate) return;
    detachCandidate.mutate(
      { vacancyId, candidateId: candidate.id },
      {
        onSuccess: () => {
          toast.success(`Откреплён от вакансии «${vacancyTitle}»`, {
            action: {
              label: 'Вернуть',
              onClick: () => attachCandidate.mutate({ vacancyId, candidateId: candidate.id }),
            },
          });
        },
        onError: () => toast.error('Не удалось открепить от вакансии'),
      },
    );
  };

  const handleEdit = (values: CandidateFormValues) => {
    if (!candidate) return;
    const skillCategories: SkillCategory[] = values.skillCategories.map((c) => ({
      id: c.id,
      name: c.name,
      items: splitStack(c.itemsText),
    }));
    const experience: CandidateExperience[] = values.experience.map((e) => ({
      id: e.id,
      company: e.company,
      position: e.position,
      startMonth: e.startMonth,
      endMonth: e.endMonth ? e.endMonth : null,
      project: e.project || undefined,
      achievements: splitLines(e.achievementsText),
      stack: splitStack(e.stackText),
    }));
    const education: CandidateEducation[] = values.education.map((e) => ({
      id: e.id,
      degree: e.degree,
      institution: e.institution,
      city: e.city || undefined,
      graduationYear: Number(e.graduationYear),
      specialty: e.specialty || undefined,
    }));
    const certifications: CandidateCertification[] = values.certifications.map((c) => ({
      id: c.id,
      title: c.title,
      issuer: c.issuer,
      period: c.period || undefined,
    }));
    const languages: CandidateLanguage[] = values.languages;
    updateCandidate.mutate(
      {
        id: candidate.id,
        payload: {
          fullName: values.fullName,
          role: values.role,
          engagementType: values.engagementType,
          grade: values.grade,
          experienceYears: Number(values.experienceYears),
          format: values.format,
          rateMonth: Number(values.rateMonth),
          employmentType: values.employmentType,
          recruiterId: values.recruiterId,
          location: values.location || '',
          birthday: values.birthday || undefined,
          telegram: values.telegram || undefined,
          phone: values.phone || undefined,
          email: values.email || undefined,
          stack: splitStack(values.stack),
          summary: values.summary || undefined,
          skillCategories,
          experience,
          education,
          certifications,
          languages,
        },
      },
      {
        onSuccess: (c) => {
          candidateDraftStorage.clear(`edit:${candidate.id}`);
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
            <Button
              variant="ghost"
              size="sm"
              disabled={!candidate}
              onClick={handleDownloadDocx}
              aria-label="Скачать резюме в DOCX"
              title="Скачать резюме в DOCX"
              className="h-8 px-2"
            >
              <span className="text-[12px]">DOCX</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!candidate || pdfPending}
              onClick={handleDownloadPdf}
              aria-label="Скачать резюме в PDF"
              title="Скачать резюме в PDF"
              className="h-8 px-2"
            >
              <span className="text-[12px]">{pdfPending ? '…' : 'PDF'}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={!candidate} aria-label="Ещё">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={handleShare}>
                  <Share2 className="mr-2 h-3.5 w-3.5" />
                  Поделиться
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleDownloadDocxMB();
                  }}
                >
                  <FileDown className="mr-2 h-3.5 w-3.5" />
                  Выгрузить для МБ
                </DropdownMenuItem>
                {candidate?.archived ? (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      handleRestore();
                    }}
                  >
                    <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                    Вернуть на доску
                  </DropdownMenuItem>
                ) : (
                  canArchive && (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setArchiveOpen(true);
                      }}
                    >
                      <Inbox className="mr-2 h-3.5 w-3.5" />
                      Убрать с доски
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
            {candidate.archived && (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <Inbox className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1 leading-relaxed">
                  <div className="font-semibold">Кандидат вне канбан-доски</div>
                  <div className="text-[11.5px] opacity-90">
                    Карточка остаётся в Базе кандидатов со всей историей.{' '}
                    {candidate.archivedAt && (
                      <>Убран{' '}
                      <span className="tnum">
                        {new Date(candidate.archivedAt).toLocaleDateString('ru-RU')}
                      </span>
                      {candidate.archiveReason ? ` · ${candidate.archiveReason}` : ''}
                      .</>
                    )}
                  </div>
                </div>
                {canArchive && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 border-amber-300/60 bg-background/80 px-2 text-[11.5px] text-amber-900 hover:bg-background dark:border-amber-800 dark:text-amber-100"
                    onClick={handleRestore}
                    disabled={restoreCandidate.isPending}
                  >
                    <ArchiveRestore className="h-3 w-3" />
                    Вернуть
                  </Button>
                )}
              </div>
            )}
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
                <EngagementBadge type={candidate.engagementType} variant="chip" />
                <span className="text-xs text-muted-foreground">
                  {candidate.experienceYears} лет опыта · {candidate.location}
                </span>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-x-7 gap-y-3.5 text-sm">
              <Field
                label="Telegram"
                value={candidate.telegram && (
                  <span className="flex items-center">
                    <a href={telegramUrl(candidate.telegram)} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {candidate.telegram}
                    </a>
                  </span>
                )}
              />
              <Field label="Телефон" value={candidate.phone && <span className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground" />{candidate.phone}</span>} />
              <Field
                label="Email"
                value={candidate.email && (
                  <a href={`mailto:${candidate.email}`} className="flex items-center gap-1.5 hover:underline">
                    <Mail className="h-3 w-3 text-muted-foreground" />
                    {candidate.email}
                  </a>
                )}
              />
              <Field label="Ожидаемая ставка" value={<span className="font-semibold">{formatMoneyRub(candidate.rateMonth)} ₽/мес</span>} />
              <Field label="Тип оформления" value={candidate.employmentType} />
              <Field
                label="Дата рождения"
                value={candidate.birthday ? new Date(candidate.birthday).toLocaleDateString('ru-RU') : undefined}
              />
              <Field label="Формат работы" value={candidate.format} />
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

            {candidate.summary && (
              <Section title="Сопроводительное письмо">
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">
                  {candidate.summary}
                </p>
              </Section>
            )}

            {candidate.skillCategories && candidate.skillCategories.length > 0 && (
              <Section title="Ключевые навыки">
                <div className="space-y-3">
                  {candidate.skillCategories.map((cat) => (
                    <div key={cat.id}>
                      <div className="mb-1 text-[11.5px] font-medium text-foreground/80">{cat.name}</div>
                      <StackTags stack={cat.items} variant="accent" />
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {candidate.experience && candidate.experience.length > 0 && (
              <Section title="Профессиональный опыт">
                <div className="space-y-3.5">
                  {candidate.experience.map((exp) => (
                    <div key={exp.id} className="rounded-md border bg-muted/20 px-3 py-2.5">
                      <div className="text-[13.5px] font-semibold leading-tight">{exp.company}</div>
                      <div className="text-[12.5px] text-foreground/80">{exp.position}</div>
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {formatPeriod(exp.startMonth, exp.endMonth)}
                      </div>
                      {exp.project && (
                        <div className="mt-2 text-[12.5px] leading-relaxed text-foreground/90">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Проект: </span>
                          {exp.project}
                        </div>
                      )}
                      {exp.achievements.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] leading-relaxed text-foreground/90 marker:text-muted-foreground">
                          {exp.achievements.map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      )}
                      {exp.stack.length > 0 && (
                        <div className="mt-2">
                          <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Стек</div>
                          <StackTags stack={exp.stack} variant="accent" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {candidate.education && candidate.education.length > 0 && (
              <Section title="Образование">
                <div className="space-y-2">
                  {candidate.education.map((edu) => (
                    <div key={edu.id} className="text-[13px] leading-snug">
                      <div className="font-semibold">{edu.degree}</div>
                      <div className="text-foreground/90">
                        {edu.institution}
                        {edu.city ? `, ${edu.city}` : ''}, {edu.graduationYear}
                      </div>
                      {edu.specialty && (
                        <div className="text-[12px] text-muted-foreground">{edu.specialty}</div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {candidate.certifications && candidate.certifications.length > 0 && (
              <Section title="Повышение квалификации">
                <div className="space-y-2">
                  {candidate.certifications.map((cert) => (
                    <div key={cert.id} className="text-[13px] leading-snug">
                      <div className="font-medium">{cert.title}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {cert.issuer}
                        {cert.period ? ` · ${cert.period}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {candidate.languages && candidate.languages.length > 0 && (
              <Section title="Знание языков">
                <div className="flex flex-wrap gap-2">
                  {candidate.languages.map((l) => (
                    <span
                      key={`${l.language}-${l.level}`}
                      className="rounded-md border bg-muted/30 px-2 py-1 text-[12px]"
                    >
                      <span className="font-medium">{l.language}</span>
                      <span className="text-muted-foreground"> · {l.level}</span>
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <Section
              title={`Прикреплённые вакансии · ${attachedVacancies.length}`}
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
              {attachedVacancies.length === 0 ? (
                <div className="py-2 text-xs text-muted-foreground">Вакансии пока не прикреплены.</div>
              ) : (
                <div className="space-y-1.5">
                  {attachedVacancies.map((v) => {
                    const client = clientsData?.items.find((c) => c.id === v.clientId);
                    return (
                      <div
                        key={v.id}
                        className="group flex items-center rounded-md border bg-muted/30 hover:bg-muted"
                      >
                        <button
                          type="button"
                          onClick={() => navigate({ to: '/vacancies/$id', params: { id: v.id } })}
                          className="flex min-w-0 flex-1 flex-col px-3 py-2.5 text-left"
                        >
                          <div className="truncate text-[13px] font-semibold">{v.title}</div>
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {client?.name ?? '—'} · {v.grade} · {v.format}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1 pr-2">
                          <span className="tnum text-xs font-semibold">
                            {v.engagementType === 'agency'
                              ? v.salaryMax
                                ? `до ${formatMoneyRub(v.salaryMax)} ₽`
                                : '—'
                              : `${formatMoneyRub(v.rateClient)} ₽`}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDetachVacancy(v.id, v.title)}
                            disabled={detachCandidate.isPending}
                            aria-label={`Открепить от вакансии «${v.title}»`}
                            title="Открепить от вакансии"
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {fromDatabase && (
              <Section title={`История смены статусов · ${statusHistory.length}`}>
                {statusHistory.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Кандидат ещё не менял статус.
                  </div>
                ) : (
                  <ol className="relative space-y-0">
                    {statusHistory.map((entry, i) => {
                      const actor = usersData?.find((u) => u.id === entry.actorId);
                      // Парсим целевой статус из текста вида:
                      // «Статус изменён на «X»» → подсветим X.
                      const match = /«([^»]+)»/.exec(entry.text);
                      const targetLabel = match?.[1] ?? entry.text;
                      const statusMeta = candidateStatuses.find((s) => s.label === targetLabel);
                      return (
                        <li
                          key={entry.id}
                          className="relative flex gap-3 pb-3.5 last:pb-0"
                        >
                          {i < statusHistory.length - 1 && (
                            <div className="absolute left-[5px] top-[14px] bottom-0 w-px bg-border" />
                          )}
                          <div
                            className="z-10 mt-[6px] h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background"
                            style={{ background: statusMeta?.color ?? '#94a3b8' }}
                          />
                          <div className="flex-1">
                            <div className="text-[13px] font-medium leading-tight">
                              {targetLabel}
                            </div>
                            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                              {actor?.fullName ?? '—'} ·{' '}
                              {new Date(entry.createdAt).toLocaleString('ru-RU')}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
            )}

            <Section title="История взаимодействий">
              {activityItems.length === 0 && (
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
              {hiddenActivityCount > 0 && (
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

            <CommentsSection entityType="candidate" entityId={candidate.id} />
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
            draftKey={`edit:${candidate.id}`}
            enableResumeImport={false}
          />
        )}
      </SheetContent>
    </Sheet>

    {/* Архивирование (убрать с доски) — softdelete. В базе кандидат остаётся. */}
    <Dialog
      open={archiveOpen}
      onOpenChange={(o) => {
        if (archiveCandidate.isPending) return;
        setArchiveOpen(o);
        if (!o) setArchiveReason('');
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Убрать кандидата с доски?</DialogTitle>
          <DialogDescription>
            {candidate && (
              <>
                Кандидат «<span className="font-medium text-foreground">{candidate.fullName}</span>» исчезнет
                с канбан-доски и будет откреплён от вакансий. В разделе{' '}
                <span className="font-medium text-foreground">«База кандидатов»</span> карточка останется
                со всей историей и диалогами — кандидата можно будет вернуть на доску.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Причина (необязательно)
          </label>
          <Textarea
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            placeholder="Например: «не подошёл по бюджету», «передумал», «long-term reserve»"
            rows={2}
            className="text-[13px]"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => setArchiveOpen(false)}
            disabled={archiveCandidate.isPending}
          >
            Отмена
          </Button>
          <Button onClick={handleArchive} disabled={archiveCandidate.isPending}>
            <Inbox className="mr-1.5 h-3.5 w-3.5" />
            {archiveCandidate.isPending ? 'Убираем…' : 'Убрать с доски'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {candidate && (
      <AttachVacancyDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        candidateId={candidate.id}
        excludeIds={candidate.vacancyIds}
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
