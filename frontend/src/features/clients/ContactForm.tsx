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
import type { Client, CreateContactRequest, UUID } from '@/api/types';

const schema = z.object({
  clientId: z.string().optional(),
  name: z.string().min(2, 'Минимум 2 символа'),
  role: z.string().min(2, 'Укажите должность'),
  email: z.union([z.literal(''), z.string().email('Некорректный email')]),
  phone: z.string(),
  telegram: z.string(),
  birthday: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите корректную дату')]),
});

export type ContactFormValues = z.infer<typeof schema>;

interface Props {
  /**
   * Если передан список клиентов — рендерим селектор «Клиент» сверху формы,
   * поле становится обязательным. Используется для глобального «Добавить контакт».
   * Если не передан — селектор не показываем (клиент задан внешне).
   */
  clients?: Pick<Client, 'id' | 'name'>[];
  /** Если передан clients, второй аргумент содержит выбранный clientId. */
  onSubmit: (values: CreateContactRequest, clientId?: UUID) => void;
  isPending?: boolean;
  submitLabel?: string;
  defaultValues?: Partial<ContactFormValues>;
}

export function ContactForm({ clients, onSubmit, isPending, submitLabel = 'Добавить', defaultValues }: Props) {
  const showClientSelect = !!clients;
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(
      showClientSelect
        ? schema.refine((v) => !!v.clientId, { message: 'Выберите клиента', path: ['clientId'] })
        : schema,
    ),
    defaultValues: {
      clientId: '',
      name: '',
      role: '',
      email: '',
      phone: '',
      telegram: '',
      birthday: '',
      ...defaultValues,
    },
  });

  const handleSubmit = (values: ContactFormValues) => {
    onSubmit(
      {
        name: values.name,
        role: values.role,
        ...(values.email ? { email: values.email } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.telegram ? { telegram: values.telegram } : {}),
        ...(values.birthday ? { birthday: values.birthday } : {}),
      },
      showClientSelect ? values.clientId : undefined,
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {showClientSelect && (
          <FormField
            control={form.control}
            name="clientId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Клиент</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ''}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите клиента" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(clients ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ФИО</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Иван Иванов" autoComplete="name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Должность</FormLabel>
              <FormControl>
                <Input {...field} placeholder="HRD, CTO, Project Manager…" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email (необязательно)</FormLabel>
              <FormControl>
                <Input {...field} type="email" placeholder="name@company.ru" autoComplete="email" />
              </FormControl>
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
              <FormControl>
                <Input {...field} type="tel" placeholder="+7 (495) 000-00-00" autoComplete="tel" />
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
              <FormLabel>Telegram-аккаунт</FormLabel>
              <FormControl>
                <Input {...field} placeholder="@username" autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="birthday"
          render={({ field }) => (
            <FormItem>
              <FormLabel>День рождения (необязательно)</FormLabel>
              <FormControl>
                <Input {...field} type="date" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
