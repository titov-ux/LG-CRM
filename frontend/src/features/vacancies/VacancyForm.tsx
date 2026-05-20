import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { VacancyImportDialog } from './VacancyImportDialog';
import type { ParsedVacancy } from './types';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useClients } from '@/features/clients/hooks';
import { useUsers } from '@/features/users/hooks';
import type { Grade, Priority, WorkFormat } from '@/api/types';

// Полная форма вакансии. Используется и в quick-create, и в drawer редактирования.

const GRADES: Grade[] = ['Junior', 'Middle', 'Senior', 'Lead'];
const FORMATS: WorkFormat[] = ['Удалённо', 'Гибрид', 'Офис'];
const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'low', label: 'Низкий' },
  { id: 'medium', label: 'Средний' },
  { id: 'high', label: 'Высокий' },
  { id: 'urgent', label: 'Срочно' },
];

const schema = z.object({
  title: z.string().min(2, 'Минимум 2 символа'),
  clientId: z.string().min(1, 'Выберите клиента'),
  project: z.string().optional(),
  grade: z.enum(['Junior', 'Middle', 'Senior', 'Lead']),
  format: z.enum(['Удалённо', 'Гибрид', 'Офис']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  rateClient: z.coerce.number().positive('Должно быть больше 0'),
  positions: z.coerce.number().int().positive(),
  stack: z.string().optional(),
  deadline: z.string().optional(),
  recruiterId: z.string().optional(),
  description: z.string().optional(),
  requirements: z.string().optional(),
});

export type VacancyFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<VacancyFormValues>;
  onSubmit: (values: VacancyFormValues) => void;
  isPending?: boolean;
  submitLabel?: string;
}

export function VacancyForm({ defaultValues, onSubmit, isPending, submitLabel = 'Сохранить' }: Props) {
  const { data: clientsData } = useClients();
  const { data: users } = useUsers();
  const recruiters = (users ?? []).filter((u) => u.role === 'recruiter');
  const [importOpen, setImportOpen] = useState(false);

  const form = useForm<VacancyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      clientId: '',
      project: '',
      grade: 'Senior',
      format: 'Удалённо',
      priority: 'medium',
      positions: 1,
      rateClient: 0,
      stack: '',
      deadline: '',
      recruiterId: '',
      description: '',
      requirements: '',
      ...defaultValues,
    } as VacancyFormValues,
  });

  const applyParsed = (parsed: ParsedVacancy) => {
    const setIf = (key: keyof VacancyFormValues, value: unknown) => {
      if (value !== undefined && value !== '' && value !== null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        form.setValue(key, value as any, { shouldDirty: true, shouldValidate: false });
      }
    };
    setIf('title', parsed.title);
    setIf('project', parsed.project);
    setIf('grade', parsed.grade);
    setIf('format', parsed.format);
    setIf('priority', parsed.priority);
    setIf('deadline', parsed.deadline);
    setIf('rateClient', parsed.rateClient);
    setIf('stack', parsed.stack);
    setIf('description', parsed.description);
    setIf('requirements', parsed.requirements);
  };

  return (
    <Form {...form}>
      <div className="mb-3 flex justify-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setImportOpen(true)}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          Распознать из текста
        </Button>
      </div>

      <VacancyImportDialog open={importOpen} onOpenChange={setImportOpen} onApply={applyParsed} />

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название</FormLabel>
              <FormControl><Input {...field} placeholder="Senior Backend (Java)" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="clientId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Клиент</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Выберите клиента" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(clientsData?.items ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="project"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Проект</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Например, Биллинг или Mobile Banking" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="grade"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Грейд</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Формат</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="rateClient"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ставка клиента (₽/ч)</FormLabel>
                <FormControl><Input type="number" min={0} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="positions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Позиций</FormLabel>
                <FormControl><Input type="number" min={1} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Приоритет</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="deadline"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дедлайн</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="recruiterId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ответственный рекрутер</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue placeholder="Не назначен" /></SelectTrigger></FormControl>
                <SelectContent>
                  {recruiters.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="stack"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Стек</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Java, Spring, Kafka, PostgreSQL" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Описание вакансии</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={5}
                  placeholder="Чем занимается команда, что за проект, особенности работы…"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="requirements"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Требования</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={6}
                  placeholder={'Обязательно:\n— …\n\nЖелательно:\n— …'}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
