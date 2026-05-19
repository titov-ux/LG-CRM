import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Briefcase, ChevronDown, Plus, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ClientForm, type ClientFormValues } from '@/features/clients/ClientForm';
import { useCreateClient } from '@/features/clients/hooks';
import { VacancyForm, type VacancyFormValues } from '@/features/vacancies/VacancyForm';
import { useCreateVacancy } from '@/features/vacancies/hooks';
import { CandidateForm, type CandidateFormValues } from '@/features/candidates/CandidateForm';
import { useCreateCandidate } from '@/features/candidates/hooks';

type Kind = 'client' | 'vacancy' | 'candidate' | null;

function splitStack(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function QuickCreateMenu() {
  const [open, setOpen] = useState<Kind>(null);
  const navigate = useNavigate();

  const createClient = useCreateClient();
  const createVacancy = useCreateVacancy();
  const createCandidate = useCreateCandidate();

  const close = () => setOpen(null);

  const handleClient = (values: ClientFormValues) => {
    createClient.mutate(values, {
      onSuccess: (c) => {
        toast.success(`Клиент «${c.name}» создан`);
        close();
        navigate({ to: '/clients/$id', params: { id: c.id } });
      },
      onError: () => toast.error('Не удалось создать клиента'),
    });
  };

  const handleVacancy = (values: VacancyFormValues) => {
    const payload = {
      title: values.title,
      clientId: values.clientId,
      grade: values.grade,
      format: values.format,
      priority: values.priority,
      rateClient: Number(values.rateClient),
      rateMax: Number(values.rateMax),
      positions: Number(values.positions),
      stack: splitStack(values.stack),
      deadline: values.deadline || null,
      recruiterIds: values.recruiterId ? [values.recruiterId] : [],
    };
    createVacancy.mutate(payload, {
      onSuccess: (v) => {
        toast.success(`Вакансия «${v.title}» создана`);
        close();
        navigate({ to: '/vacancies/$id', params: { id: v.id } });
      },
      onError: () => toast.error('Не удалось создать вакансию'),
    });
  };

  const handleCandidate = (values: CandidateFormValues) => {
    const payload = {
      fullName: values.fullName,
      role: values.role,
      grade: values.grade,
      experienceYears: Number(values.experienceYears),
      format: values.format,
      rate: Number(values.rate),
      recruiterId: values.recruiterId,
      location: values.location || '',
      source: values.source || 'Прямой поиск',
      email: values.email || undefined,
      phone: values.phone || undefined,
      stack: splitStack(values.stack),
    };
    createCandidate.mutate(payload, {
      onSuccess: (c) => {
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
          <DropdownMenuItem onSelect={() => setOpen('client')}>
            <Users className="mr-2 h-4 w-4" />
            Клиента
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={open === 'client'} onOpenChange={(o) => !o && close()}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новый клиент</SheetTitle>
            <SheetDescription>Заполните основные поля. Контакты можно добавить позже.</SheetDescription>
          </SheetHeader>
          <ClientForm onSubmit={handleClient} isPending={createClient.isPending} submitLabel="Создать" />
        </SheetContent>
      </Sheet>

      <Sheet open={open === 'vacancy'} onOpenChange={(o) => !o && close()}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новая вакансия</SheetTitle>
            <SheetDescription>Кандидаты прикрепляются после создания.</SheetDescription>
          </SheetHeader>
          <VacancyForm onSubmit={handleVacancy} isPending={createVacancy.isPending} submitLabel="Создать" />
        </SheetContent>
      </Sheet>

      <Sheet open={open === 'candidate'} onOpenChange={(o) => !o && close()}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новый кандидат</SheetTitle>
            <SheetDescription>Можно прикрепить к вакансии позже из карточки.</SheetDescription>
          </SheetHeader>
          <CandidateForm onSubmit={handleCandidate} isPending={createCandidate.isPending} submitLabel="Создать" />
        </SheetContent>
      </Sheet>
    </>
  );
}
