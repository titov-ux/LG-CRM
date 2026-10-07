import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { DateField } from '@/components/forms/DateField';
import { useUsers } from '@/features/users/hooks';
import type { Priority } from '@/api/types';
import { LEAD_OWNER_ROLES, LEAD_SOURCES } from './statuses';

const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'low', label: 'Низкий' },
  { id: 'medium', label: 'Средний' },
  { id: 'high', label: 'Высокий' },
  { id: 'urgent', label: 'Срочно' },
];

const MAX_SUM = 100_000_000_000;

const optionalSum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().nonnegative('Не может быть отрицательным').max(MAX_SUM).optional(),
);

const schema = z
  .object({
    company: z.string().trim().min(2, 'Укажите компанию'),
    title: z.string().trim().min(2, 'Опишите потребность — минимум 2 символа'),
    industry: z.string().optional(),
    website: z.string().optional(),
    contactName: z.string().optional(),
    contactPosition: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().trim().email('Некорректный email').optional().or(z.literal('')),
    telegram: z.string().optional(),
    source: z.string().optional(),
    expectedValue: optionalSum,
    nextContactDate: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    accountManagerId: z.string().optional(),
    note: z.string().optional(),
  });

export type LeadFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<LeadFormValues>;
  onSubmit: (values: LeadFormValues) => void;
  isPending?: boolean;
  submitLabel?: string;
  onCancel?: () => void;
}

export function LeadForm({
  defaultValues,
  onSubmit,
  isPending,
  submitLabel = 'Сохранить',
  onCancel,
}: Props) {
  const { data: users } = useUsers();
  const accountManagers = (users ?? []).filter(
    (u) => LEAD_OWNER_ROLES.includes(u.role) && u.isActive,
  );

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      company: '',
      title: '',
      industry: '',
      website: '',
      contactName: '',
      contactPosition: '',
      phone: '',
      email: '',
      telegram: '',
      source: '',
      expectedValue: undefined,
      nextContactDate: '',
      priority: 'medium',
      accountManagerId: '',
      note: '',
      ...defaultValues,
    },
  });

  const text = (
    name: keyof LeadFormValues,
    label: string,
    placeholder?: string,
    extra?: React.InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              placeholder={placeholder}
              {...extra}
              {...field}
              value={(field.value as string | number | undefined) ?? ''}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormSection title="Компания">
          {text('company', 'Компания', 'ООО «Ромашка»')}
          {text('title', 'Потребность', 'Подбор 5 Java-разработчиков, аутстафф…')}
          <div className="grid grid-cols-2 gap-3">
            {text('industry', 'Отрасль', 'IT, ритейл, производство…')}
            {text('website', 'Сайт', 'romashka.ru')}
          </div>
        </FormSection>

        <FormSection title="Контактное лицо">
          <div className="grid grid-cols-2 gap-3">
            {text('contactName', 'ФИО', 'Иван Петров')}
            {text('contactPosition', 'Должность', 'HR-директор')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {text('phone', 'Телефон', '+7 900 000-00-00', { type: 'tel', inputMode: 'tel' })}
            {text('email', 'Email', 'ivan@romashka.ru', { type: 'email', inputMode: 'email' })}
          </div>
          {text('telegram', 'Telegram', '@username')}
        </FormSection>

        <FormSection title="Сделка">
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Источник</FormLabel>
                  <FormControl>
                    <Input list="lead-sources" placeholder="Сайт, рекомендация…" {...field} />
                  </FormControl>
                  <datalist id="lead-sources">
                    {LEAD_SOURCES.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <FormMessage />
                </FormItem>
              )}
            />
            {text('expectedValue', 'Потенциал сделки, ₽', '0', {
              type: 'number',
              inputMode: 'numeric',
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="nextContactDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Следующий контакт</FormLabel>
                  <FormControl>
                    <DateField value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Приоритет</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="accountManagerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ответственный</FormLabel>
                <Select
                  value={field.value || '__none__'}
                  onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Без ответственного" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">Без ответственного</SelectItem>
                    {accountManagers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Заметки</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder="Что обсудили, боли клиента, договорённости…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <div className="flex justify-end gap-2 pt-1">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
              Отмена
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
