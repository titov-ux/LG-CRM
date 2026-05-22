import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
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
import { vacancyDraftStorage } from '@/features/vacancies/draftStorage';
import { CandidateForm, type CandidateFormValues } from '@/features/candidates/CandidateForm';
import { useCreateCandidate } from '@/features/candidates/hooks';
import { candidateDraftStorage } from '@/features/candidates/draftStorage';

// Сквозная кнопка «Создать» в шапке. Сюда сознательно вынесены только сущности,
// которые могут создаваться из любой точки приложения: вакансия и кандидат.
// Клиент создаётся только со страницы /clients (там есть собственная кнопка),
// потому что без контекста выбранного клиента отдельной точки входа не нужно.
type Kind = 'vacancy' | 'candidate' | null;

function splitStack(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function QuickCreateMenu() {
  const [open, setOpen] = useState<Kind>(null);
  const [candidateFormResetKey, setCandidateFormResetKey] = useState(0);
  const navigate = useNavigate();

  const createVacancy = useCreateVacancy();
  const createCandidate = useCreateCandidate();

  const close = () => setOpen(null);
  const closeCandidateSheet = () => {
    candidateDraftStorage.clear('create');
    setCandidateFormResetKey((k) => k + 1);
    close();
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
        vacancyDraftStorage.clear('create');
        toast.success(`Вакансия «${v.title}» создана`);
        close();
        navigate({ to: '/vacancies' });
      },
      onError: () => toast.error('Не удалось создать вакансию'),
    });
  };

  const handleCandidate = (values: CandidateFormValues) => {
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
      stack: splitStack(values.stack),
    };
    createCandidate.mutate(payload, {
      onSuccess: (c) => {
        candidateDraftStorage.clear('create');
        toast.success(`Кандидат «${c.fullName}» создан`);
        close();
        navigate({ to: '/candidates/$id', params: { id: c.id } });
      },
      onError: () => toast.error('Не удалось создать кандидата'),
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
          <DropdownMenuItem onSelect={() => setOpen('vacancy')}>
            <Briefcase className="mr-2 h-4 w-4" />
            Вакансию
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen('candidate')}>
            <UserPlus className="mr-2 h-4 w-4" />
            Кандидата
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={open === 'vacancy'} onOpenChange={(o) => !o && close()}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новая вакансия</SheetTitle>
            <SheetDescription>Кандидаты прикрепляются после создания.</SheetDescription>
          </SheetHeader>
          <VacancyForm
            onSubmit={handleVacancy}
            isPending={createVacancy.isPending}
            submitLabel="Создать"
            draftKey="create"
          />
        </SheetContent>
      </Sheet>

      <Sheet open={open === 'candidate'} onOpenChange={(o) => !o && closeCandidateSheet()}>
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
            draftKey="create"
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
