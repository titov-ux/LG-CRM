import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { HTTPError } from 'ky';
import { Briefcase, ChevronDown, Plus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { VacancyForm, type VacancyFormValues } from '@/features/vacancies/VacancyForm';
import { useCreateVacancy } from '@/features/vacancies/hooks';
import { CandidateForm, type CandidateFormValues } from '@/features/candidates/CandidateForm';
import { useCreateCandidate } from '@/features/candidates/hooks';
import { useCan } from '@/lib/permissions';

// Сквозная кнопка «Создать» в шапке. Сюда сознательно вынесены только сущности,
// которые могут создаваться из любой точки приложения: вакансия и кандидат.
// Клиент создаётся только со страницы /clients (там есть собственная кнопка),
// потому что без контекста выбранного клиента отдельной точки входа не нужно.
type Kind = 'vacancy' | 'candidate' | null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function getApiErrorMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof HTTPError)) return null;
  try {
    const body = (await error.response.clone().json()) as
      | { detail?: string | { message?: string } | Array<{ msg?: string }> }
      | undefined;
    const detail = body?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.message?.trim()) {
      return detail.message.trim();
    }
    if (Array.isArray(detail)) {
      const first = detail.find((i) => typeof i?.msg === 'string' && i.msg.trim());
      if (first?.msg) return first.msg.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function fallbackErrorText(error: unknown): string {
  if (error instanceof HTTPError) {
    const status = error.response.status;
    if (status === 0) return 'Ошибка сети при запросе к API';
    return `Ошибка API (${status}) при создании кандидата`;
  }
  if (error instanceof Error && error.message.trim()) {
    return `Ошибка: ${error.message.trim()}`;
  }
  return 'Не удалось создать кандидата';
}

export function QuickCreateMenu() {
  const [open, setOpen] = useState<Kind>(null);
  const [vacancyFormResetKey, setVacancyFormResetKey] = useState(0);
  const [candidateFormResetKey, setCandidateFormResetKey] = useState(0);
  const navigate = useNavigate();

  const createVacancy = useCreateVacancy();
  const createCandidate = useCreateCandidate();
  const disabledDomains = ((import.meta.env.VITE_DISABLED_HANDLERS as string | undefined) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const candidatesViaRealApi = disabledDomains.includes('candidates');
  const canCreateVacancy = useCan('vacancy:create');
  const canCreateCandidate = useCan('candidate:create');

  if (!canCreateVacancy && !canCreateCandidate) return null;

  const close = () => setOpen(null);
  // Форму сбрасываем при ОТКРЫТИИ, а не при закрытии: Radix держит контент
  // смонтированным во время анимации закрытия и переиспользует инстанс формы
  // при быстром повторном открытии. Если бампать ключ только на закрытии, то
  // путь «успешное создание → close()» его не задевает, и в новой форме всплывают
  // значения только что созданной вакансии/кандидата. Сброс на открытии
  // гарантирует чистую форму при любом сценарии закрытия.
  const openVacancy = () => {
    setVacancyFormResetKey((k) => k + 1);
    setOpen('vacancy');
  };
  const openCandidate = () => {
    setCandidateFormResetKey((k) => k + 1);
    setOpen('candidate');
  };

  const handleVacancy = (values: VacancyFormValues) => {
    const isAgency = values.engagementType === 'agency';
    const payload = {
      title: values.title,
      clientId: values.clientId,
      engagementType: values.engagementType,
      project: values.project?.trim() || undefined,
      grade: values.grade,
      format: values.format,
      priority: values.priority,
      rateClient: isAgency ? 0 : Number(values.rateClient ?? 0),
      salaryMax: isAgency ? (values.salaryMax != null ? Number(values.salaryMax) : null) : null,
      positions: Number(values.positions),
      stack: splitStack(values.stack),
      deadline: values.deadline || null,
      accountManagerId: values.accountManagerId,
      recruiterIds: values.recruiterIds ?? [],
      description: values.description?.trim() || undefined,
      requirements: values.requirements?.trim() || undefined,
    };
    createVacancy.mutate(payload, {
      onSuccess: (v) => {
        toast.success(`Вакансия «${v.title}» создана`);
        close();
        navigate({ to: '/vacancies' });
      },
      onError: () => toast.error('Не удалось создать вакансию'),
    });
  };

  const handleCandidate = (values: CandidateFormValues) => {
    if (candidatesViaRealApi && !UUID_RE.test(values.recruiterId)) {
      toast.error('Выберите рекрутера из реального API (ожидается UUID)');
      return;
    }
    const skillCategories = values.skillCategories.map((c) => ({
      id: c.id,
      name: c.name,
      items: splitStack(c.itemsText),
    }));
    const experience = values.experience.map((e) => ({
      id: e.id,
      company: e.company,
      position: e.position,
      startMonth: e.startMonth,
      endMonth: e.endMonth ? e.endMonth : null,
      project: e.project || undefined,
      achievements: splitLines(e.achievementsText),
      stack: splitStack(e.stackText),
    }));
    const education = values.education.map((e) => ({
      id: e.id,
      degree: e.degree,
      institution: e.institution,
      city: e.city || undefined,
      graduationYear: Number(e.graduationYear),
      specialty: e.specialty || undefined,
    }));
    const certifications = values.certifications.map((c) => ({
      id: c.id,
      title: c.title,
      issuer: c.issuer,
      period: c.period || undefined,
    }));
    const languages = values.languages;

    const payload = {
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
    };
    createCandidate.mutate(payload, {
      onSuccess: (c) => {
        toast.success(`Кандидат «${c.fullName}» создан`);
        close();
        navigate({ to: '/candidates/$id', params: { id: c.id } });
      },
      onError: async (error) => {
        if (error instanceof HTTPError) {
          if (error.response.status === 403) {
            toast.error('Недостаточно прав для создания кандидата');
            return;
          }
          if (error.response.status === 409) {
            toast.error(
              (await getApiErrorMessage(error)) ?? 'Кандидат с таким email или телефоном уже существует',
            );
            return;
          }
          if (error.response.status === 422) {
            toast.error(
              (await getApiErrorMessage(error)) ?? 'Проверьте корректность заполненных полей кандидата',
            );
            return;
          }
        }
        toast.error((await getApiErrorMessage(error)) ?? fallbackErrorText(error));
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Создать
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canCreateVacancy && (
            <DropdownMenuItem onSelect={openVacancy}>
              <Briefcase className="mr-2 h-4 w-4" />
              Вакансию
            </DropdownMenuItem>
          )}
          {canCreateCandidate && (
            <DropdownMenuItem onSelect={openCandidate}>
              <UserPlus className="mr-2 h-4 w-4" />
              Кандидата
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={canCreateVacancy && open === 'vacancy'} onOpenChange={(o) => !o && close()}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новая вакансия</SheetTitle>
            <SheetDescription>Кандидаты прикрепляются после создания.</SheetDescription>
          </SheetHeader>
          <VacancyForm
            key={vacancyFormResetKey}
            onSubmit={handleVacancy}
            isPending={createVacancy.isPending}
            submitLabel="Создать"
          />
        </SheetContent>
      </Sheet>

      <Sheet open={canCreateCandidate && open === 'candidate'} onOpenChange={(o) => !o && close()}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новый кандидат</SheetTitle>
            <SheetDescription>Можно прикрепить к вакансии позже из карточки.</SheetDescription>
          </SheetHeader>
          <CandidateForm
            key={candidateFormResetKey}
            onSubmit={handleCandidate}
            isPending={createCandidate.isPending}
            submitLabel="Создать"
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
