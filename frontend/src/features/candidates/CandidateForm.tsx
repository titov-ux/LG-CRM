import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useUsers } from '@/features/users/hooks';
import { EngagementTypeField } from '@/components/forms/EngagementTypeField';
import { DateField } from '@/components/forms/DateField';
import type { EmploymentType, EngagementType, Grade, WorkFormat } from '@/api/types';

const GRADES: Grade[] = ['Junior', 'Middle', 'Senior', 'Lead'];
const FORMATS: WorkFormat[] = ['Удалённо', 'Гибрид', 'Офис'];
const EMPLOYMENT_TYPES: EmploymentType[] = ['ИП', 'СМЗ', 'ТК РФ'];

const schema = z.object({
  fullName: z.string().min(2, 'Введите ФИО'),
  role: z.string().min(2, 'Укажите позицию'),
  engagementType: z.enum(['outstaff', 'agency'], {
    required_error: 'Выберите тип',
  }) as z.ZodType<EngagementType>,
  grade: z.enum(['Junior', 'Middle', 'Senior', 'Lead']),
  experienceYears: z.coerce.number().int().min(0).max(60),
  format: z.enum(['Удалённо', 'Гибрид', 'Офис']),
  rateMonth: z.coerce.number().nonnegative(),
  employmentType: z.enum(['ИП', 'СМЗ', 'ТК РФ']),
  recruiterId: z.string().min(1, 'Выберите рекрутера'),
  location: z.string().optional(),
  source: z.string().optional(),
  birthday: z.string().optional(),
  telegram: z.string().optional(),
  phone: z.string().optional(),
  stack: z.string().optional(),
});

export type CandidateFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<CandidateFormValues>;
  onSubmit: (values: CandidateFormValues) => void;
  isPending?: boolean;
  submitLabel?: string;
}

export function CandidateForm({ defaultValues, onSubmit, isPending, submitLabel = 'Сохранить' }: Props) {
  const { data: users } = useUsers();
  // В качестве «ответственных рекрутеров» можно назначать и админов — они тоже ведут кандидатов.
  const recruiters = (users ?? []).filter((u) => u.role === 'recruiter' || u.role === 'admin');

  const form = useForm<CandidateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      role: '',
      engagementType: 'outstaff',
      grade: 'Senior',
      experienceYears: 0,
      format: 'Удалённо',
      rateMonth: 0,
      employmentType: 'ИП',
      recruiterId: '',
      location: '',
      source: 'HeadHunter',
      birthday: '',
      telegram: '',
      phone: '',
      stack: '',
      ...defaultValues,
    } as CandidateFormValues,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="engagementType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Тип</FormLabel>
              <FormControl>
                <EngagementTypeField value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ФИО</FormLabel>
              <FormControl><Input {...field} placeholder="Иванов Иван Иванович" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Позиция</FormLabel>
                <FormControl><Input {...field} placeholder="Backend Developer" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="experienceYears"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Опыт, лет</FormLabel>
                <FormControl><Input type="number" min={0} {...field} /></FormControl>
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
            name="rateMonth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ставка (₽/мес)</FormLabel>
                <FormControl><Input type="number" min={0} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="employmentType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Тип оформления</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
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
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger></FormControl>
                <SelectContent>
                  {recruiters.map((r) => <SelectItem key={r.id} value={r.id}>{r.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-3 gap-3">
          <FormField
            control={form.control}
            name="birthday"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дата рождения</FormLabel>
                <FormControl>
                  <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="telegram"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telegram</FormLabel>
                <FormControl><Input {...field} placeholder="@ivan_ivanov" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Телефон</FormLabel>
                <FormControl><Input {...field} placeholder="+7 (999) 000-00-00" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="location"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Локация</FormLabel>
                <FormControl><Input {...field} placeholder="Москва" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="source"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Источник</FormLabel>
                <FormControl><Input {...field} placeholder="HeadHunter, LinkedIn…" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="stack"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Стек</FormLabel>
              <FormControl><Input {...field} placeholder="Java, Spring, PostgreSQL" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
